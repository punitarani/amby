import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { ConversationRuntime, makeConversationRuntimeLive } from "@amby/agent"
import { type BufferedMessage, resolveTelegramUser, type TelegramFrom } from "@amby/channels"
import type { WorkerBindings } from "@amby/env/workers"
import { createTelegramAdapter } from "@chat-adapter/telegram"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import type {
	ClaimFirstOutboundInput,
	ClaimFirstOutboundResult,
	CompleteExecutionInput,
	ExecutionOutcome,
} from "../durable-objects/conversation-session-state"
import { makeAgentRuntimeForConsumer, makeRuntimeForConsumer } from "../runtime/worker-runtime"
import { setTelegramScope } from "../sentry"
import { AGENT_LOOP_STEP_OPTIONS, createTelegramDeliveryController } from "./telegram-delivery"

interface ConversationSessionStub {
	completeExecution(input: CompleteExecutionInput): Promise<unknown>
	claimFirstOutbound(input: ClaimFirstOutboundInput): Promise<ClaimFirstOutboundResult>
}

export const RESOLVE_USER_STEP_OPTIONS = {
	retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
	timeout: "30 seconds",
} as const

export interface AgentExecutionParams {
	chatId: number
	messages: BufferedMessage[]
	userId: string | null
	from: TelegramFrom | null
	conversationId?: string | null
	executionToken: string
	isSubAgent?: boolean
	parentContext?: string
}

export class AgentExecutionWorkflow extends WorkflowEntrypoint<
	WorkerBindings,
	AgentExecutionParams
> {
	async run(event: WorkflowEvent<AgentExecutionParams>, step: WorkflowStep) {
		const { chatId, messages, from, isSubAgent, parentContext, executionToken } = event.payload
		let { userId, conversationId } = event.payload
		let outcome: ExecutionOutcome = "completed"
		let response = ""
		let runError: unknown = null
		let userResolutionBlocked = false
		let result = { response, userId, conversationId }

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
				execution_token: executionToken,
			},
		})

		const adapter = createTelegramAdapter({
			botToken: this.env.TELEGRAM_BOT_TOKEN ?? "",
			apiBaseUrl: this.env.TELEGRAM_API_BASE_URL,
			mode: "webhook",
		})
		const chatIdStr = String(chatId)
		const doStub = this.getConversationSessionStub(chatId, isSubAgent)
		const delivery = createTelegramDeliveryController({
			adapter,
			chatId: chatIdStr,
			claimFirstOutbound: async () => {
				if (!doStub) {
					return { allowed: false, reason: "stale" as const }
				}
				return doStub.claimFirstOutbound({ executionToken })
			},
		})

		try {
			if (!isSubAgent) {
				await step.do("typing", () => delivery.startTyping())
			}

			if (from) {
				userId = await step.do("resolve-user", RESOLVE_USER_STEP_OPTIONS, async () => {
					const runtime = makeRuntimeForConsumer(this.env)
					try {
						const resolved = await runtime.runPromise(resolveTelegramUser(from, chatId))
						if (resolved.status === "blocked") {
							userResolutionBlocked = true
							if (!isSubAgent) {
								await delivery.sendRelinkRequired()
							}
							outcome = "blocked"
							return null
						}
						return resolved.userId
					} finally {
						await runtime.dispose()
					}
				})
			}

			if (!userId) {
				outcome = userResolutionBlocked ? "blocked" : "failed"
				Sentry.captureMessage(
					"Agent execution workflow missing both userId and Telegram identity",
					"error",
				)
				console.error("[Workflow] No userId and no from data — cannot proceed")
				result = { response, userId, conversationId }
			} else {
				const finalUserId = userId
				const messageTexts = messages.map((message) => message.text)
				const input = parentContext
					? `${parentContext}\n\nUser: ${messageTexts.join("\n\n")}`
					: messageTexts.join("\n\n")

				response = await step.do("agent-loop", AGENT_LOOP_STEP_OPTIONS, async () => {
					const typingInterval = setInterval(() => {
						void delivery.startTyping()
					}, 4000)

					let streamedText = ""
					let streamMessageId: string | null = null
					let isEditing = false

					const flushStream = async () => {
						if (isEditing || !streamedText) return
						isEditing = true
						try {
							streamMessageId = await delivery.flushStreamText(streamedText, streamMessageId)
						} finally {
							isEditing = false
						}
					}

					const streamInterval = !isSubAgent ? setInterval(() => void flushStream(), 500) : null
					const onTextDelta = !isSubAgent
						? (delta: string) => {
								streamedText += delta
							}
						: undefined

					try {
						const runtime = makeAgentRuntimeForConsumer(this.env)
						try {
							const effect = Effect.gen(function* () {
								const agent = yield* ConversationRuntime
								const convId =
									conversationId ?? (yield* agent.ensureConversation("telegram", String(chatId)))
								conversationId = convId

								const sendReply = async (text: string) => {
									await delivery.sendProgress(text)
								}

								if (messageTexts.length > 1) {
									return yield* agent.handleBatchedMessages(
										convId,
										messageTexts,
										{
											telegram: { batched: true, messageCount: messageTexts.length },
										},
										sendReply,
										onTextDelta,
									)
								}
								return yield* agent.handleMessage(convId, input, undefined, sendReply, onTextDelta)
							}).pipe(Effect.provide(makeConversationRuntimeLive(finalUserId)))

							const agentResult = await runtime.runPromise(effect)
							const finalText = agentResult.userResponse.text

							if (streamInterval) clearInterval(streamInterval)
							await delivery.finalizeResponse(finalText, streamMessageId)

							return finalText
						} finally {
							await runtime.dispose()
						}
					} finally {
						if (streamInterval) clearInterval(streamInterval)
						clearInterval(typingInterval)
					}
				})

				Sentry.logger.info("Agent execution completed", {
					workflow_instance_id: event.instanceId,
					message_count: messages.length,
					response_length: response.length,
					is_sub_agent: Boolean(isSubAgent),
					execution_token: executionToken,
				})

				result = { response, userId, conversationId }
			}
		} catch (err) {
			runError = err
			outcome = "failed"
			if (!isSubAgent) {
				await step.do("error-reply", async () => {
					await delivery.sendErrorReply("Sorry, something went wrong. Please try again.")
				})
			}
			result = { response, userId, conversationId }
		}

		try {
			await this.notifyComplete(step, {
				chatId,
				isSubAgent,
				userId,
				conversationId,
				executionToken,
				outcome,
			})
		} catch (completeError) {
			Sentry.captureException(completeError)
			console.error("[Workflow] Failed to notify ConversationSession completion:", completeError)
			if (!runError) {
				runError = completeError
			}
		}

		if (runError) {
			throw runError
		}

		return result
	}

	private getConversationSessionStub(chatId: number, isSubAgent?: boolean) {
		const doBinding = this.env.CONVERSATION_SESSION
		if (isSubAgent || !doBinding) return null
		const doId = doBinding.idFromName(String(chatId))
		return doBinding.get(doId) as unknown as ConversationSessionStub
	}

	private async notifyComplete(
		step: WorkflowStep,
		params: {
			chatId: number
			isSubAgent?: boolean
			userId: string | null
			conversationId: string | null | undefined
			executionToken: string
			outcome: ExecutionOutcome
		},
	) {
		const doStub = this.getConversationSessionStub(params.chatId, params.isSubAgent)
		if (!doStub) return

		await step.do("complete", async () => {
			await doStub.completeExecution({
				executionToken: params.executionToken,
				userId: params.userId ?? undefined,
				conversationId: params.conversationId ?? undefined,
				outcome: params.outcome,
			})
		})
	}
}
