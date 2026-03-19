import type { ChannelType } from "@amby/channels"
import { createComputerTools, createCuaTools, SandboxService, TaskSupervisor } from "@amby/computer"
import { DbService, desc, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import {
	buildMemoriesText,
	createMemoryTools,
	deduplicateMemories,
	MemoryService,
} from "@amby/memory"
import { ModelService } from "@amby/models"
import { Context, Effect, Layer } from "effect"
import {
	flushBraintrust,
	generateText,
	initializeBraintrust,
	stepCountIs,
	streamText,
	traceBraintrustOperation,
} from "./braintrust"
import { AgentError } from "./errors"

export type StreamPart =
	| { type: "text-delta"; text: string }
	| { type: "tool-call"; toolName: string; args: Record<string, unknown> }
	| { type: "tool-result"; toolName: string; result: unknown }

import { buildSystemPrompt, CUA_PROMPT } from "./prompts/system"
import { createSubagentTools } from "./subagents/spawner"
import { buildToolGroups } from "./subagents/tool-groups"
import { createCodexAuthTools } from "./tools/codex-auth"
import { createSandboxDelegationTools } from "./tools/delegation"
import { createJobTools, createReplyTools, type ReplyFn } from "./tools/messaging"

export class AgentService extends Context.Tag("AgentService")<
	AgentService,
	{
		readonly handleMessage: (
			conversationId: string,
			content: string,
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
		) => Effect.Effect<string, AgentError>
		readonly handleBatchedMessages: (
			conversationId: string,
			messages: string[],
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
		) => Effect.Effect<string, AgentError>
		readonly streamMessage: (
			conversationId: string,
			content: string,
			onPart: (part: StreamPart) => void,
		) => Effect.Effect<string, AgentError>
		readonly ensureConversation: (channelType?: ChannelType) => Effect.Effect<string, AgentError>
		readonly shutdown: () => Effect.Effect<void, AgentError>
	}
>() {}

const compactRecord = (record: Record<string, unknown>) =>
	Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))

const summarizeRequestMetadata = (metadata?: Record<string, unknown>) => {
	if (!metadata) return undefined

	const telegram = metadata.telegram
	const telegramMetadata =
		telegram && typeof telegram === "object" && !Array.isArray(telegram)
			? (telegram as Record<string, unknown>)
			: undefined

	return compactRecord({
		keys: Object.keys(metadata),
		source: Object.hasOwn(metadata, "telegram") ? "telegram" : undefined,
		telegramBatched:
			typeof telegramMetadata?.batched === "boolean" ? telegramMetadata.batched : undefined,
		telegramMessageCount:
			typeof telegramMetadata?.messageCount === "number"
				? telegramMetadata.messageCount
				: undefined,
	})
}

export const makeAgentServiceLive = (userId: string) =>
	Layer.effect(
		AgentService,
		Effect.gen(function* () {
			const { db, query } = yield* DbService
			const models = yield* ModelService
			const memory = yield* MemoryService
			const sandbox = yield* SandboxService
			const taskSupervisor = yield* TaskSupervisor
			const env = yield* EnvService
			const enableCua = env.ENABLE_CUA
			initializeBraintrust(env.BRAINTRUST_API_KEY, env.BRAINTRUST_PROJECT_ID)
			const baseModel = models.getModel()

			const computer = createComputerTools(sandbox, userId)

			const loadHistory = (conversationId: string) =>
				query((d) =>
					d
						.select({ role: schema.messages.role, content: schema.messages.content })
						.from(schema.messages)
						.where(eq(schema.messages.conversationId, conversationId))
						.orderBy(desc(schema.messages.createdAt))
						.limit(20),
				).pipe(
					Effect.map((rows) =>
						rows
							.reverse()
							.filter(
								(r): r is { role: "user" | "assistant"; content: string } =>
									r.role === "user" || r.role === "assistant",
							),
					),
				)

			const saveMessage = (
				conversationId: string,
				role: "user" | "assistant" | "system" | "tool",
				content: string,
				metadata?: Record<string, unknown>,
			) =>
				query((d) => d.insert(schema.messages).values({ conversationId, role, content, metadata }))

			const maybeSaveAssistantMessage = (conversationId: string, content: string) =>
				content.trim() ? saveMessage(conversationId, "assistant", content) : Effect.void

			/**
			 * Scans tool results from last to first, returning the first `userMessages` array found.
			 *
			 * When a tool returns `{ userMessages: string[] }`, those messages are sent directly
			 * to the user via onReply and the LLM's own text response is suppressed (finalText = "").
			 * This lets tools like codex-auth relay multi-step instructions (e.g. device-code URLs)
			 * without the LLM paraphrasing them.
			 */
			const extractLastToolUserMessages = (result: {
				toolResults: ReadonlyArray<{ output?: unknown } | undefined>
			}): string[] | undefined => {
				for (let i = result.toolResults.length - 1; i >= 0; i -= 1) {
					const output = result.toolResults[i]?.output
					if (
						typeof output === "object" &&
						output !== null &&
						"userMessages" in output &&
						Array.isArray(output.userMessages) &&
						output.userMessages.every((message) => typeof message === "string" && message.trim())
					) {
						return output.userMessages
					}
				}
			}

			const prepareContext = (conversationId: string, onReply?: ReplyFn) =>
				Effect.gen(function* () {
					const userRow = yield* query((d) =>
						d
							.select({ timezone: schema.users.timezone })
							.from(schema.users)
							.where(eq(schema.users.id, userId))
							.limit(1),
					)
					const userTimezone = userRow[0]?.timezone ?? "UTC"

					const formatted = new Intl.DateTimeFormat("en-US", {
						timeZone: userTimezone,
						dateStyle: "full",
						timeStyle: "long",
					}).format(new Date())

					const profile = yield* memory.getProfile(userId)
					const deduped = deduplicateMemories(profile.static, profile.dynamic)
					const memoryContext = buildMemoriesText(deduped)

					const history = yield* loadHistory(conversationId)

					const memoryTools = createMemoryTools(memory, userId)
					const sandboxTools = sandbox.enabled
						? createSandboxDelegationTools(taskSupervisor, userId)
						: undefined
					const codexAuthTools = sandbox.enabled
						? createCodexAuthTools(taskSupervisor, userId)
						: undefined
					const cuaTools = enableCua
						? createCuaTools(sandbox, userId, conversationId, computer.getSandbox).tools
						: undefined
					const toolGroups = buildToolGroups(memoryTools, computer.tools, cuaTools)

					const basePrompt = enableCua
						? `${buildSystemPrompt(formatted, userTimezone)}\n\n${CUA_PROMPT}`
						: buildSystemPrompt(formatted, userTimezone)
					const systemPrompt = memoryContext
						? `${basePrompt}\n\n# User Memory Context\n${memoryContext}`
						: basePrompt

					const sharedContext = [
						memoryContext ? `# User Memory Context\n${memoryContext}` : "",
						`# Current Date/Time\n${formatted} (${userTimezone})`,
					]
						.filter(Boolean)
						.join("\n\n")

					const delegationTools = createSubagentTools(baseModel, toolGroups, sharedContext)

					// Orchestrator gets: delegation tools + read-only memory search + jobs + reply
					const { search_memories } = memoryTools
					const tools = {
						...delegationTools,
						search_memories,
						...(sandboxTools ?? {}),
						...(codexAuthTools ?? {}),
						...createJobTools(db, userId, userTimezone),
						...(onReply ? createReplyTools(onReply) : {}),
					}

					return { tools, systemPrompt, history, userTimezone }
				})

			const buildTraceMetadata = ({
				conversationId,
				mode,
				historyLength,
				toolCount,
				userTimezone,
				replyToolEnabled,
				messageCount,
				requestMetadata,
			}: {
				conversationId: string
				mode: "message" | "batched-message" | "stream-message"
				historyLength: number
				toolCount: number
				userTimezone: string
				replyToolEnabled: boolean
				messageCount: number
				requestMetadata?: Record<string, unknown>
			}) =>
				compactRecord({
					userId,
					conversationId,
					mode,
					messageCount,
					historyLength,
					toolCount,
					replyToolEnabled,
					userTimezone,
					modelId: models.defaultModelId,
					cuaEnabled: enableCua,
					requestMetadata: summarizeRequestMetadata(requestMetadata),
				})

			return {
				handleMessage: (conversationId, content, metadata, onReply) =>
					Effect.gen(function* () {
						const { tools, systemPrompt, history, userTimezone } = yield* prepareContext(
							conversationId,
							onReply,
						)

						const result = yield* Effect.tryPromise({
							try: () =>
								traceBraintrustOperation(
									"agent.handle-message",
									{ content },
									buildTraceMetadata({
										conversationId,
										mode: "message",
										historyLength: history.length,
										toolCount: Object.keys(tools).length,
										userTimezone,
										replyToolEnabled: Boolean(onReply),
										messageCount: 1,
										requestMetadata: metadata,
									}),
									() =>
										generateText({
											model: baseModel,
											system: systemPrompt,
											messages: [...history, { role: "user" as const, content }],
											tools,
											stopWhen: stepCountIs(10),
										}),
									(response) => ({ text: response.text }),
								),
							catch: (cause) => new AgentError({ message: "Failed to generate response", cause }),
						})
						const toolUserMessages = onReply ? extractLastToolUserMessages(result) : undefined
						if (toolUserMessages && onReply) {
							yield* Effect.tryPromise(async () => {
								for (const message of toolUserMessages) {
									await onReply(message)
								}
							})
						}
						const finalText = toolUserMessages ? "" : result.text

						yield* saveMessage(conversationId, "user", content, metadata)
						yield* maybeSaveAssistantMessage(conversationId, finalText)

						return finalText
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent message handling failed", cause: e }),
						),
					),

				handleBatchedMessages: (conversationId, messages, metadata, onReply) =>
					Effect.gen(function* () {
						const { tools, systemPrompt, history, userTimezone } = yield* prepareContext(
							conversationId,
							onReply,
						)

						// Each batched message becomes a separate user turn
						const userMessages = messages.map((content) => ({
							role: "user" as const,
							content,
						}))

						const result = yield* Effect.tryPromise({
							try: () =>
								traceBraintrustOperation(
									"agent.handle-batched-messages",
									{ messages },
									buildTraceMetadata({
										conversationId,
										mode: "batched-message",
										historyLength: history.length,
										toolCount: Object.keys(tools).length,
										userTimezone,
										replyToolEnabled: Boolean(onReply),
										messageCount: messages.length,
										requestMetadata: metadata,
									}),
									() =>
										generateText({
											model: baseModel,
											system: systemPrompt,
											messages: [...history, ...userMessages],
											tools,
											stopWhen: stepCountIs(10),
										}),
									(response) => ({ text: response.text }),
								),
							catch: (cause) => new AgentError({ message: "Failed to generate response", cause }),
						})
						const toolUserMessages = onReply ? extractLastToolUserMessages(result) : undefined
						if (toolUserMessages && onReply) {
							yield* Effect.tryPromise(async () => {
								for (const message of toolUserMessages) {
									await onReply(message)
								}
							})
						}
						const finalText = toolUserMessages ? "" : result.text

						// Save each message individually for accurate history
						for (const content of messages) {
							yield* saveMessage(conversationId, "user", content, metadata)
						}
						yield* maybeSaveAssistantMessage(conversationId, finalText)

						return finalText
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent batched message handling failed", cause: e }),
						),
					),

				streamMessage: (conversationId, content, onPart) =>
					Effect.gen(function* () {
						const { tools, systemPrompt, history, userTimezone } =
							yield* prepareContext(conversationId)

						const result = yield* Effect.tryPromise({
							try: () =>
								traceBraintrustOperation(
									"agent.stream-message",
									{ content },
									buildTraceMetadata({
										conversationId,
										mode: "stream-message",
										historyLength: history.length,
										toolCount: Object.keys(tools).length,
										userTimezone,
										replyToolEnabled: false,
										messageCount: 1,
									}),
									async () => {
										const stream = streamText({
											model: baseModel,
											system: systemPrompt,
											messages: [...history, { role: "user" as const, content }],
											tools,
											stopWhen: stepCountIs(10),
										})

										for await (const part of stream.fullStream) {
											switch (part.type) {
												case "text-delta":
													onPart({ type: "text-delta", text: part.text })
													break
												case "tool-call":
													onPart({
														type: "tool-call",
														toolName: part.toolName,
														args: part.input as Record<string, unknown>,
													})
													break
												case "tool-result":
													onPart({
														type: "tool-result",
														toolName: part.toolName,
														result: part.output,
													})
													break
											}
										}

										return await stream.text
									},
									(text) => ({ text }),
								),
							catch: (cause) => new AgentError({ message: "Failed to stream response", cause }),
						})

						yield* saveMessage(conversationId, "user", content)
						yield* saveMessage(conversationId, "assistant", result)

						return result
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent stream handling failed", cause: e }),
						),
					),

				ensureConversation: (channelType = "cli") =>
					query((d) =>
						d.transaction(async (tx) => {
							const existing = await tx
								.select({ id: schema.conversations.id })
								.from(schema.conversations)
								.where(eq(schema.conversations.userId, userId))
								.orderBy(desc(schema.conversations.updatedAt))
								.limit(1)

							if (existing[0]) return existing[0].id

							const rows = await tx
								.insert(schema.conversations)
								.values({ userId, channelType })
								.returning({ id: schema.conversations.id })

							const row = rows[0]
							if (!row) throw new Error("Failed to create conversation")
							return row.id
						}),
					).pipe(
						Effect.mapError(
							(e) =>
								new AgentError({
									message: `Failed to ensure conversation: ${e instanceof Error ? e.message : String(e)}`,
									cause: e,
								}),
						),
					),

				shutdown: () =>
					Effect.gen(function* () {
						yield* taskSupervisor.shutdown()
						yield* Effect.tryPromise({
							try: () => flushBraintrust(),
							catch: (cause) => new AgentError({ message: "Failed to flush Braintrust", cause }),
						})
						const instance = computer.getSandbox()
						if (instance) {
							yield* sandbox
								.stop(instance)
								.pipe(
									Effect.mapError(
										(e) => new AgentError({ message: "Failed to stop sandbox", cause: e }),
									),
								)
						}
					}),
			}
		}),
	)
