import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { AgentService, makeAgentServiceLive } from "@amby/agent"
import type { WorkerBindings } from "@amby/env/workers"
import { Effect } from "effect"
import { Bot } from "grammy"
import { makeRuntimeForConsumer } from "../queue/runtime"
import type { BufferedMessage, TelegramFrom } from "../telegram/utils"
import { findOrCreateUser, splitTelegramMessage } from "../telegram/utils"

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

		const bot = new Bot(this.env.TELEGRAM_BOT_TOKEN ?? "")

		const sendTyping = () => bot.api.sendChatAction(chatId, "typing").catch(() => {})

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
				console.error("[Workflow] No userId and no from data — cannot proceed")
				return
			}

			// Step 3: Run the agent
			const finalUserId = userId
			const messageTexts = messages.map((m) => m.text)
			const input = parentContext
				? `${parentContext}\n\nUser: ${messageTexts.join("\n\n")}`
				: messageTexts.join("\n\n")

			const response = await step.do(
				"agent-loop",
				{
					retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
					timeout: "5 minutes",
				},
				async () => {
					// Typing indicator inside the step — survives retries, no leak
					const typingInterval = setInterval(sendTyping, 4000)
					try {
						const runtime = makeRuntimeForConsumer(this.env)
						try {
							const sendReply = (text: string) => bot.api.sendMessage(chatId, text).then(() => {})
							const effect = Effect.gen(function* () {
								const agent = yield* AgentService
								const convId = conversationId ?? (yield* agent.ensureConversation("telegram"))
								conversationId = convId

								if (messageTexts.length > 1) {
									return yield* agent.handleBatchedMessages(
										convId,
										messageTexts,
										{
											telegram: { batched: true, messageCount: messageTexts.length },
										},
										sendReply,
									)
								}
								return yield* agent.handleMessage(convId, input, undefined, sendReply)
							}).pipe(Effect.provide(makeAgentServiceLive(finalUserId)))

							return await runtime.runPromise(effect)
						} finally {
							await runtime.dispose()
						}
					} finally {
						clearInterval(typingInterval)
					}
				},
			)

			// Step 4: Send response to Telegram (split if >4096 chars)
			if (!isSubAgent && response.trim()) {
				await step.do("reply", async () => {
					for (const chunk of splitTelegramMessage(response)) {
						await bot.api.sendMessage(chatId, chunk)
					}
				})
			}

			// Step 5: Notify the DO that execution is complete
			await this.notifyComplete(step, chatId, isSubAgent, userId, conversationId)

			return { response, userId, conversationId }
		} catch (err) {
			// Send error message to user and reset DO state
			if (!isSubAgent) {
				await step.do("error-reply", async () => {
					await bot.api
						.sendMessage(chatId, "Sorry, something went wrong. Please try again.")
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
