import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { ConversationRuntime, makeConversationRuntimeLive } from "@amby/agent"
import { AttachmentService } from "@amby/attachments"
import { TELEGRAM_RELINK_REQUIRED_MESSAGE } from "@amby/auth"
import { type BufferedMessage, resolveTelegramUser, type TelegramFrom } from "@amby/channels"
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
	executionToken: string
}

export class AgentExecutionWorkflow extends WorkflowEntrypoint<
	WorkerBindings,
	AgentExecutionParams
> {
	async run(event: WorkflowEvent<AgentExecutionParams>, step: WorkflowStep) {
		const { chatId, messages, from, isSubAgent, parentContext, executionToken } = event.payload
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
				execution_token: executionToken,
			},
		})

		const replyTarget = { channel: "telegram" as const, chatId }

		// Outbound claim state — shared across steps
		let outboundState: "unchecked" | "claimed" | "denied" = "unchecked"

		const ensureOutbound = async (): Promise<boolean> => {
			if (outboundState === "claimed") return true
			if (outboundState === "denied") return false
			if (isSubAgent) {
				outboundState = "claimed"
				return true
			}
			const doBinding = this.env.CONVERSATION_SESSION
			if (!doBinding) {
				outboundState = "claimed"
				return true
			}
			const doId = doBinding.idFromName(String(chatId))
			const stub = doBinding.get(doId)
			const result = await stub.claimFirstOutbound({ executionToken })
			if (result.allowed) {
				outboundState = "claimed"
				return true
			}
			outboundState = "denied"
			Sentry.logger.info("Outbound claim denied", {
				reason: result.reason,
				execution_token: executionToken,
			})
			return false
		}

		try {
			// Step 1: Resolve user from Telegram identity
			if (from) {
				userId = await step.do("resolve-user", async () => {
					const runtime = makeRuntimeForConsumer(this.env)
					try {
						const resolved = await runtime.runPromise(resolveTelegramUser(from, chatId))
						if (resolved.status === "blocked") {
							if (await ensureOutbound()) {
								await runtime
									.runPromise(
										Effect.gen(function* () {
											const replySender = yield* ReplySender
											yield* Effect.tryPromise(() =>
												replySender.postText(
													{ channel: "telegram", chatId },
													TELEGRAM_RELINK_REQUIRED_MESSAGE,
												),
											)
										}),
									)
									.catch(() => {})
							}
							return null
						}
						return resolved.userId
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

			// Step 2: Run the agent with streaming
			const finalUserId = userId

			const response = await step.do(
				"agent-loop",
				{
					retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
					timeout: "5 minutes",
				},
				async () => {
					const runtime = makeAgentRuntimeForConsumer(this.env)
					let streamInterval: ReturnType<typeof setInterval> | null = null
					let streamedText = ""
					let streamMessageId: string | null = null
					let isEditing = false
					let streamingSuppressed = false

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

						// Single typing pulse (no recurring interval)
						if (!isSubAgent) {
							await services.replySender.startTyping(replyTarget).catch(() => {})
						}

						const flushStream = async () => {
							if (isEditing || !streamedText || isSubAgent || streamingSuppressed)
								return
							isEditing = true
							try {
								if (!streamMessageId) {
									// First flush: claim outbound before any visible send
									if (!(await ensureOutbound())) {
										streamingSuppressed = true
										if (streamInterval) clearInterval(streamInterval)
										return
									}
								}
								const displayText =
									streamedText.length > 4090
										? `${streamedText.slice(0, 4087)}...`
										: streamedText
								if (!streamMessageId) {
									const draft = await services.replySender.postText(
										replyTarget,
										displayText,
									)
									streamMessageId = draft?.id ?? null
								} else {
									await services.replySender.editText(
										replyTarget,
										{ id: streamMessageId },
										displayText,
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
									(yield* services.agent.ensureConversation(
										"telegram",
										String(chatId),
									))
								conversationId = convId

								let structuredMessages =
									yield* services.attachments.ingestBufferedMessages({
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

								const sendReply = (text: string) =>
									services.replySender
										.postText(replyTarget, text)
										.then(() => {})

								if (structuredMessages.length > 1) {
									return yield* services.agent.handleStructuredBatch(
										convId,
										structuredMessages,
										{
											telegram: {
												batched: true,
												messageCount: structuredMessages.length,
											},
										},
										sendReply,
										onTextDelta,
										ensureOutbound,
									)
								}

								return yield* services.agent.handleStructuredMessage(
									convId,
									structuredMessages[0] ?? {
										contentText: "",
										parts: [],
									},
									undefined,
									sendReply,
									onTextDelta,
									ensureOutbound,
								)
							}).pipe(Effect.provide(makeConversationRuntimeLive(finalUserId))),
						)

						if (streamInterval) clearInterval(streamInterval)

						// If outbound was denied (stale/superseded), skip all delivery
						if (outboundState === "denied" || result.status === "cancelled") {
							if (streamMessageId) {
								await services.replySender
									.deleteMessage(replyTarget, { id: streamMessageId })
									.catch(() => {})
							}
							return ""
						}

						const finalText = result.userResponse.text.trim()
						const attachmentParts = result.userResponse.parts.filter(
							(part) => part.type === "attachment",
						)

						// Delivery: claim outbound if not yet claimed (e.g. no streaming happened)
						if (finalText && !(await ensureOutbound())) {
							return ""
						}

						// Safe delivery: avoid stranding the preview
						try {
							if (streamMessageId) {
								if (finalText && finalText.length <= 4096) {
									// Edit preview in place — no delete-then-post gap
									await services.replySender.editText(
										replyTarget,
										{ id: streamMessageId },
										finalText,
									)
								} else {
									if (finalText) {
										await services.replySender.postText(
											replyTarget,
											finalText,
										)
									}
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
						} catch (err) {
							// After first outbound is claimed, do not rethrow delivery errors
							// to prevent the step from retrying and duplicating visible output
							Sentry.captureException(err)
							console.error("[Workflow] Post-claim delivery error:", err)
						}

						return finalText
					} finally {
						if (streamInterval) clearInterval(streamInterval)
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

			// Step 3: Notify the DO that execution is complete
			await this.notifyComplete(step, chatId, isSubAgent, userId, conversationId, executionToken)

			return { response, userId, conversationId }
		} catch (err) {
			// Send error message to user and reset DO state
			if (!isSubAgent && (await ensureOutbound())) {
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
			await this.notifyComplete(step, chatId, isSubAgent, userId, conversationId, executionToken)
			throw err
		}
	}

	private async notifyComplete(
		step: WorkflowStep,
		chatId: number,
		isSubAgent: boolean | undefined,
		userId: string | null,
		conversationId: string | null | undefined,
		executionToken: string,
	) {
		const doBinding = this.env.CONVERSATION_SESSION
		if (isSubAgent || !doBinding) return

		await step.do("complete", async () => {
			const doId = doBinding.idFromName(String(chatId))
			const stub = doBinding.get(doId)
			const result = await stub.completeExecution({
				executionToken,
				userId: userId ?? undefined,
				conversationId: conversationId ?? undefined,
			})
			if (!result.accepted) {
				Sentry.logger.warn("Completion rejected (stale token)", {
					execution_token: executionToken,
				})
			}
			if (result.shouldRerun) {
				Sentry.logger.info("Superseded execution — rerun scheduled by DO", {
					execution_token: executionToken,
				})
			}
		})
	}
}
