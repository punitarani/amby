import type { WorkerBindings } from "@amby/env/workers"
import type { TelegramQueueMessage } from "../telegram/utils"
import { handleCommand } from "../telegram/utils"
import { makeRuntimeForConsumer } from "./runtime"

const COMMANDS = new Set(["/start", "/stop", "/help"])

export async function handleQueueBatch(
	batch: MessageBatch<TelegramQueueMessage>,
	env: WorkerBindings,
) {
	for (const msg of batch.messages) {
		const { update } = msg.body
		const message = update.message

		if (!message?.from || !message.chat?.id) {
			msg.ack()
			continue
		}

		const text = message.text ?? ""
		const chatId = message.chat.id
		const from = message.from

		if (COMMANDS.has(text)) {
			// Handle simple commands inline — fast, stateless
			const runtime = makeRuntimeForConsumer(env)
			try {
				await runtime.runPromise(handleCommand(text, from, chatId))
			} catch (err) {
				console.error(`[Queue] Command ${text} failed for chat ${chatId}:`, err)
			} finally {
				await runtime.dispose()
			}
		} else if (message.text) {
			// Route text messages to ConversationSession Durable Object
			const doBinding = env.CONVERSATION_SESSION
			if (!doBinding) {
				console.error("[Queue] CONVERSATION_SESSION binding not available")
				msg.ack()
				continue
			}

			try {
				const doId = doBinding.idFromName(String(chatId))
				const stub = doBinding.get(doId)
				await stub.ingestMessage({
					text: message.text,
					chatId,
					messageId: message.message_id,
					date: message.date,
					from,
				})
			} catch (err) {
				console.error(`[Queue] Failed to route message to DO for chat ${chatId}:`, err)
				msg.retry()
				continue
			}
		}

		msg.ack()
	}
}
