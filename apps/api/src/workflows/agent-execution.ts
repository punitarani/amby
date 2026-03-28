import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { ConversationRuntime, makeConversationRuntimeLive } from "@amby/agent"
import { AttachmentService } from "@amby/attachments"
import { type BufferedMessage, findOrCreateUser, type TelegramFrom } from "@amby/channels"
import { ReplySender } from "@amby/core"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import { makeAgentRuntimeForConsumer, makeRuntimeForConsumer } from "../queue/runtime"
import { setTelegramScope } from "../sentry"

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

		const replyTarget = { channel: "telegram" as const, chatId }

		const sendTyping = (sender: {
			startTyping(target: { channel: "telegram"; chatId: number }): Promise<void>
		}) => sender.startTyping(replyTarget).catch(() => {})

		try {
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

			const response = await step.do(
				"agent-loop",
				{
					retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
					timeout: "5 minutes",
				},
				async () => {
					const runtime = makeAgentRuntimeForConsumer(this.env)
					let typingInterval: ReturnType<typeof setInterval> | null = null
					let streamInterval: ReturnType<typeof setInterval> | null = null
					let streamedText = ""
					let streamMessageId: string | null = null
					let isEditing = false

					try {
						const services = await runtime.runPromise(
							Effect.gen(function* () {
								return {
									agent: yield* ConversationRuntime,
									replySender: yield* ReplySender,
									attachments: yield* AttachmentService,
								}
							}).pipe(Effect.provide(makeConversationRuntimeLive(finalUserId))),
						)

						if (!isSubAgent) {
							await sendTyping(services.replySender)
							typingInterval = setInterval(() => void sendTyping(services.replySender), 4000)
						}

						const flushStream = async () => {
							if (isEditing || !streamedText || isSubAgent) return
							isEditing = true
							try {
								if (!streamMessageId) {
									const draft = await services.replySender.postText(replyTarget, streamedText)
									streamMessageId = draft?.id ?? null
								} else {
									await services.replySender.editText(
										replyTarget,
										{ id: streamMessageId },
										streamedText,
									)
								}
							} catch {
								/* ignore draft edit errors */
							} finally {
								isEditing = false
							}
						}

						if (!isSubAgent) {
							streamInterval = setInterval(() => void flushStream(), 500)
						}

						const onTextDelta = !isSubAgent
							? (delta: string) => {
									streamedText += delta
								}
							: undefined

						const result = await runtime.runPromise(
							Effect.gen(function* () {
								const convId =
									conversationId ??
									(yield* services.agent.ensureConversation("telegram", String(chatId)))
								conversationId = convId

								let structuredMessages = yield* services.attachments.ingestBufferedMessages({
									userId: finalUserId,
									conversationId: convId,
									messages,
								})

								if (parentContext?.trim()) {
									if (structuredMessages[0]) {
										structuredMessages = [
											{
												contentText:
													`${parentContext}\n\n${structuredMessages[0].contentText}`.trim(),
												parts: [
													{ type: "text", text: parentContext },
													...structuredMessages[0].parts,
												],
											},
											...structuredMessages.slice(1),
										]
									} else {
										structuredMessages = [
											{
												contentText: parentContext,
												parts: [{ type: "text", text: parentContext }],
											},
										]
									}
								}

								if (structuredMessages.length > 1) {
									return yield* services.agent.handleStructuredBatch(
										convId,
										structuredMessages,
										{
											telegram: { batched: true, messageCount: structuredMessages.length },
										},
										(text) => services.replySender.postText(replyTarget, text).then(() => {}),
										onTextDelta,
									)
								}

								return yield* services.agent.handleStructuredMessage(
									convId,
									structuredMessages[0] ?? {
										contentText: "",
										parts: [],
									},
									undefined,
									(text) => services.replySender.postText(replyTarget, text).then(() => {}),
									onTextDelta,
								)
							}).pipe(Effect.provide(makeConversationRuntimeLive(finalUserId))),
						)

						const finalText = result.userResponse.text.trim()
						const attachmentParts = result.userResponse.parts.filter(
							(part) => part.type === "attachment",
						)

						if (streamInterval) clearInterval(streamInterval)

						if (streamMessageId) {
							if (finalText) {
								await services.replySender
									.editText(replyTarget, { id: streamMessageId }, finalText)
									.catch(() => {})
							} else {
								await services.replySender
									.deleteMessage(replyTarget, { id: streamMessageId })
									.catch(() => {})
							}
						} else if (!isSubAgent && finalText) {
							await services.replySender.postText(replyTarget, finalText)
						}

						if (!isSubAgent && attachmentParts.length > 0) {
							await services.replySender.sendParts(replyTarget, attachmentParts)
						}

						return finalText
					} finally {
						if (streamInterval) clearInterval(streamInterval)
						if (typingInterval) clearInterval(typingInterval)
						await runtime.dispose()
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
					const runtime = makeRuntimeForConsumer(this.env)
					try {
						await runtime.runPromise(
							Effect.gen(function* () {
								const replySender = yield* ReplySender
								yield* Effect.tryPromise(() =>
									replySender.postText(
										{ channel: "telegram", chatId },
										"Sorry, something went wrong. Please try again.",
									),
								)
							}),
						)
					} finally {
						await runtime.dispose()
					}
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
