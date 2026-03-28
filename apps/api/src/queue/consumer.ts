import {
	buildBufferedTelegramMessage,
	handleCommand,
	parseTelegramCommand,
	type TelegramQueueMessage,
} from "@amby/channels"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { setTelegramScope, setWorkerScope } from "../sentry"
import { makeRuntimeForConsumer } from "./runtime"

export async function handleQueueBatch(
	batch: MessageBatch<TelegramQueueMessage>,
	env: WorkerBindings,
) {
	for (const msg of batch.messages) {
		await Sentry.withIsolationScope(async () => {
			const { update, receivedAt } = msg.body
			const message = update.message

			setWorkerScope("telegram.queue", {
				queue_batch_size: batch.messages.length,
				queue_received_at: receivedAt,
				telegram_update_id: update.update_id,
			})

			if (!message?.from || !message.chat?.id) {
				msg.ack()
				return
			}

			const text = message.text ?? ""
			const chatId = message.chat.id
			const from = message.from
			const parsedCommand = parseTelegramCommand(text, env.TELEGRAM_BOT_USERNAME)
			const isCommand = Boolean(parsedCommand)

			setTelegramScope({
				component: "telegram.queue",
				chatId,
				from,
				attributes: {
					queue_batch_size: batch.messages.length,
					queue_received_at: receivedAt,
					telegram_update_id: update.update_id,
					telegram_message_id: message.message_id,
					is_command: isCommand,
				},
			})

			await Sentry.startSpan(
				{
					op: "queue.process",
					name: isCommand ? "telegram.command" : "telegram.message",
				},
				async () => {
					if (parsedCommand) {
						// Handle simple commands inline — fast, stateless
						const runtime = makeRuntimeForConsumer(env)
						try {
							await runtime.runPromise(
								handleCommand(parsedCommand, from, chatId, {
									sandboxWorkflow: env.SANDBOX_WORKFLOW,
								}),
							)
							Sentry.logger.info("Telegram command processed", {
								command: parsedCommand.rawText,
								telegram_chat_id: chatId,
								telegram_from_id: from.id,
								telegram_message_id: message.message_id,
							})
						} catch (err) {
							Sentry.captureException(err)
							console.error(
								`[Queue] Command ${parsedCommand.rawText} failed for chat ${chatId}:`,
								err,
							)
						} finally {
							await runtime.dispose()
						}
					} else {
						const bufferedMessage = buildBufferedTelegramMessage(message)
						if (!bufferedMessage) {
							return
						}
						// Route supported Telegram messages to ConversationSession Durable Object
						const doBinding = env.CONVERSATION_SESSION
						if (!doBinding) {
							console.error("[Queue] CONVERSATION_SESSION binding not available")
							return
						}

						try {
							const doId = doBinding.idFromName(String(chatId))
							const stub = doBinding.get(doId)
							await Sentry.startSpan(
								{
									op: "durable-object.rpc",
									name: "ConversationSession.ingestMessage",
								},
								async () => {
									await stub.ingestMessage({
										message: bufferedMessage,
										chatId,
										messageId: message.message_id,
										date: message.date,
										from,
									})
								},
							)
							Sentry.logger.info("Telegram message buffered", {
								telegram_chat_id: chatId,
								telegram_from_id: from.id,
								telegram_message_id: message.message_id,
								message_length: bufferedMessage.textSummary.length,
							})
						} catch (err) {
							Sentry.captureException(err)
							console.error(`[Queue] Failed to route message to DO for chat ${chatId}:`, err)
							msg.retry()
							return
						}
					}
				},
			)

			msg.ack()
		})
	}
}
