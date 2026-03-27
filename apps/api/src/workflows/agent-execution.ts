import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { AgentService, makeAgentServiceLive } from "@amby/agent"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import { makeAgentRuntimeForConsumer, makeRuntimeForConsumer } from "../queue/runtime"
import { setTelegramScope } from "../sentry"
import { createTelegramAdapter } from "../telegram/adapter"
import { splitTelegramHtmlMessage, telegramHtml } from "../telegram/html-format"
import type { BufferedMessage, TelegramFrom } from "../telegram/utils"
import { findOrCreateUser } from "../telegram/utils"

export interface AgentExecutionParams {
	chatId: number
	messages: BufferedMessage[]
	userId: string | null
	from: TelegramFrom | null
	conversationId?: string | null
	isSubAgent?: boolean
	parentContext?: string
}

export class AgentExecutionWorkflow extends WorkflowEntrypoint<
	WorkerBindings,
	AgentExecutionParams
> {
	async run(event: WorkflowEvent<AgentExecutionParams>, step: WorkflowStep) {
		const { chatId, messages, from, isSubAgent, parentContext } = event.payload
		let { userId, conversationId } = event.payload

		setTelegramScope({
			component: "workflow.agent_execution",
			chatId,
			from,
			userId,
			conversationId,
			attributes: {
				workflow_instance_id: event.instanceId,
				message_count: messages.length,
				is_sub_agent: Boolean(isSubAgent),
			},
		})

		const adapter = createTelegramAdapter({
			botToken: this.env.TELEGRAM_BOT_TOKEN ?? "",
			apiBaseUrl: this.env.TELEGRAM_API_BASE_URL,
			mode: "webhook",
		})
		const chatIdStr = String(chatId)

		const sendTyping = () => adapter.startTyping(chatIdStr).catch(() => {})

		try {
			// Step 1: Send typing indicator
			if (!isSubAgent) {
				await step.do("typing", () => sendTyping())
			}

			// Step 2: Always resolve user from Telegram identity to ensure the ID is valid
			// (the DO may cache a stale userId if the DB was reset)
			if (from) {
				userId = await step.do("resolve-user", async () => {
					const runtime = makeRuntimeForConsumer(this.env)
					try {
						return await runtime.runPromise(findOrCreateUser(from, chatId))
					} finally {
						await runtime.dispose()
					}
				})
			}

			if (!userId) {
				Sentry.captureMessage(
					"Agent execution workflow missing both userId and Telegram identity",
					"error",
				)
				console.error("[Workflow] No userId and no from data — cannot proceed")
				return
			}

			// Step 3: Run the agent with streaming
			const finalUserId = userId
			const messageTexts = messages.map((m) => m.text)
			const input = parentContext
				? `${parentContext}\n\nUser: ${messageTexts.join("\n\n")}`
				: messageTexts.join("\n\n")
			const telegramMetadata = {
				telegram: {
					batched: messageTexts.length > 1,
					messageCount: messageTexts.length,
				},
			}

			const response = await step.do(
				"agent-loop",
				{
					retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
					timeout: "5 minutes",
				},
				async () => {
					const typingInterval = setInterval(sendTyping, 4000)

					try {
						const runtime = makeAgentRuntimeForConsumer(this.env)
						try {
							const sendReply = (text: string) =>
								adapter.postMessage(chatIdStr, telegramHtml(text)).then(() => {})
							const effect = Effect.gen(function* () {
								const agent = yield* AgentService
								const convId =
									conversationId ?? (yield* agent.ensureConversation("telegram", String(chatId)))
								conversationId = convId

								if (messageTexts.length > 1) {
									return yield* agent.handleBatchedMessages(
										convId,
										messageTexts,
										telegramMetadata,
										sendReply,
									)
								}
								return yield* agent.handleMessage(convId, input, telegramMetadata, sendReply)
							}).pipe(Effect.provide(makeAgentServiceLive(finalUserId)))

							const result = await runtime.runPromise(effect)
							const finalText = result.userResponse.text

							if (!isSubAgent && finalText.trim()) {
								for (const chunk of splitTelegramHtmlMessage(finalText)) {
									await adapter.postMessage(chatIdStr, telegramHtml(chunk))
								}
							}

							return finalText
						} finally {
							await runtime.dispose()
						}
					} finally {
						clearInterval(typingInterval)
					}
				},
			)
			Sentry.logger.info("Agent execution completed", {
				workflow_instance_id: event.instanceId,
				message_count: messages.length,
				response_length: response.length,
				is_sub_agent: Boolean(isSubAgent),
			})

			// Step 4: Notify the DO that execution is complete
			await this.notifyComplete(step, chatId, isSubAgent, userId, conversationId)

			return { response, userId, conversationId }
		} catch (err) {
			// Send error message to user and reset DO state
			if (!isSubAgent) {
				await step.do("error-reply", async () => {
					await adapter
						.postMessage(chatIdStr, "Sorry, something went wrong. Please try again.")
						.catch(() => {})
				})
			}
			await this.notifyComplete(step, chatId, isSubAgent, userId, conversationId)
			throw err
		}
	}

	private async notifyComplete(
		step: WorkflowStep,
		chatId: number,
		isSubAgent: boolean | undefined,
		userId: string | null,
		conversationId: string | null | undefined,
	) {
		const doBinding = this.env.CONVERSATION_SESSION
		if (isSubAgent || !doBinding) return

		await step.do("complete", async () => {
			const doId = doBinding.idFromName(String(chatId))
			const stub = doBinding.get(doId) as unknown as {
				completeExecution(result: { userId?: string; conversationId?: string }): Promise<void>
			}
			await stub.completeExecution({
				userId: userId ?? undefined,
				conversationId: conversationId ?? undefined,
			})
		})
	}
}
