import type { ChannelType } from "@amby/channels"
import { createComputerTools, createCuaTools, SandboxService, TaskSupervisor } from "@amby/computer"
import { ConnectorsService, createConnectorManagementTools } from "@amby/connectors"
import { DbService, desc, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import {
	buildMemoriesText,
	createMemoryTools,
	deduplicateMemories,
	MemoryService,
} from "@amby/memory"
import { ModelService } from "@amby/models"
import type { ToolSet } from "ai"
import { Context, Effect, Layer } from "effect"
import {
	flushBraintrust,
	initializeBraintrust,
	stepCountIs,
	ToolLoopAgent,
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

type RequestMode = "message" | "batched-message" | "stream-message"
type UsageSummary = {
	inputTokens?: number
	outputTokens?: number
	totalTokens?: number
}
type StepLifecycleEvent = {
	stepNumber: number
	finishReason: string
	toolCalls?: Array<{ toolName: string }>
	usage?: UsageSummary
}
type FinishLifecycleEvent = {
	steps: unknown[]
	totalUsage?: UsageSummary
}

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

const summarizeUsage = (usage?: UsageSummary) =>
	usage
		? compactRecord({
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				totalTokens: usage.totalTokens,
			})
		: undefined

export class AgentService extends Context.Tag("AgentService")<
	AgentService,
	{
		readonly handleMessage: (
			conversationId: string,
			content: string,
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
			onTextDelta?: (text: string) => void,
		) => Effect.Effect<string, AgentError>
		readonly handleBatchedMessages: (
			conversationId: string,
			messages: string[],
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
			onTextDelta?: (text: string) => void,
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

export const makeAgentServiceLive = (userId: string) =>
	Layer.effect(
		AgentService,
		Effect.gen(function* () {
			const { db, query } = yield* DbService
			const models = yield* ModelService
			const memory = yield* MemoryService
			const sandbox = yield* SandboxService
			const taskSupervisor = yield* TaskSupervisor
			const connectors = yield* ConnectorsService
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
					const connectorManagementTools = connectors.isEnabled()
						? createConnectorManagementTools(connectors, userId)
						: undefined
					const connectorSessionTools = connectors.isEnabled()
						? yield* connectors.getAgentTools(userId).pipe(
								Effect.catchAll((error) =>
									Effect.sync(() => {
										console.error("[Agent] Failed to load Composio tools:", error)
										return undefined
									}),
								),
							)
						: undefined

					const { search_memories } = memoryTools
					const tools = {
						...delegationTools,
						search_memories,
						...(connectorManagementTools ?? {}),
						...(connectorSessionTools ?? {}),
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
				mode: RequestMode
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

			const createOrchestrator = (systemPrompt: string, tools: ToolSet) =>
				new ToolLoopAgent({
					model: baseModel,
					instructions: systemPrompt,
					tools,
					stopWhen: stepCountIs(14),
				})

			const createLifecycleCallbacks = (traceMetadata: Record<string, unknown>) => {
				const toolNames = new Set<string>()
				const stepFinishReasons = new Set<string>()
				let stepCount = 0

				const syncTraceMetadata = (totalUsage?: UsageSummary) => {
					Object.assign(
						traceMetadata,
						compactRecord({
							stepCount,
							stepFinishReasons: stepFinishReasons.size > 0 ? [...stepFinishReasons] : undefined,
							toolNames: toolNames.size > 0 ? [...toolNames] : undefined,
							totalUsage: summarizeUsage(totalUsage),
						}),
					)
				}

				return {
					onStepFinish: async ({
						stepNumber,
						finishReason,
						toolCalls,
						usage,
					}: StepLifecycleEvent) => {
						stepCount = Math.max(stepCount, stepNumber)
						stepFinishReasons.add(finishReason)
						for (const toolCall of toolCalls ?? []) {
							toolNames.add(toolCall.toolName)
						}
						syncTraceMetadata(usage)
					},
					onFinish: async ({ steps, totalUsage }: FinishLifecycleEvent) => {
						stepCount = Math.max(stepCount, steps.length)
						syncTraceMetadata(totalUsage)
					},
				}
			}

			const sendToolUserMessages = (toolUserMessages: string[], onReply: ReplyFn) =>
				Effect.tryPromise(async () => {
					for (const message of toolUserMessages) {
						await onReply(message)
					}
				})

			const runGenerateRequest = ({
				conversationId,
				mode,
				operationName,
				input,
				requestMessages,
				metadata,
				onReply,
				onTextDelta,
			}: {
				conversationId: string
				mode: Extract<RequestMode, "message" | "batched-message">
				operationName: "agent.handle-message" | "agent.handle-batched-messages"
				input: { content: string } | { messages: string[] }
				requestMessages: ReadonlyArray<{ role: "user"; content: string }>
				metadata?: Record<string, unknown>
				onReply?: ReplyFn
				onTextDelta?: (text: string) => void
			}) =>
				Effect.gen(function* () {
					const { tools, systemPrompt, history, userTimezone } = yield* prepareContext(
						conversationId,
						onReply,
					)
					const traceMetadata = buildTraceMetadata({
						conversationId,
						mode,
						historyLength: history.length,
						toolCount: Object.keys(tools).length,
						userTimezone,
						replyToolEnabled: Boolean(onReply),
						messageCount: requestMessages.length,
						requestMetadata: metadata,
					})
					const lifecycle = createLifecycleCallbacks(traceMetadata)
					const agent = createOrchestrator(systemPrompt, tools as ToolSet)

					const result = yield* Effect.tryPromise({
						try: () =>
							traceBraintrustOperation(
								operationName,
								input,
								traceMetadata,
								onTextDelta
									? async () => {
											const stream = await agent.stream({
												messages: [...history, ...requestMessages],
												onStepFinish: lifecycle.onStepFinish,
												onFinish: lifecycle.onFinish,
											})
											for await (const part of stream.fullStream) {
												if (part.type === "text-delta") {
													onTextDelta(part.text)
												}
											}
											const [text, toolResults] = await Promise.all([
												stream.text,
												stream.toolResults,
											])
											return { text, toolResults }
										}
									: () =>
											agent.generate({
												messages: [...history, ...requestMessages],
												onStepFinish: lifecycle.onStepFinish,
												onFinish: lifecycle.onFinish,
											}),
								(response) => ({ text: response.text }),
							),
						catch: (cause) => new AgentError({ message: "Failed to generate response", cause }),
					})
					const toolUserMessages = onReply ? extractLastToolUserMessages(result) : undefined
					if (toolUserMessages && onReply) {
						yield* sendToolUserMessages(toolUserMessages, onReply)
					}
					const finalText = toolUserMessages ? "" : result.text

					for (const message of requestMessages) {
						yield* saveMessage(conversationId, "user", message.content, metadata)
					}
					yield* maybeSaveAssistantMessage(conversationId, finalText)

					return finalText
				})

			return {
				handleMessage: (conversationId, content, metadata, onReply, onTextDelta) =>
					runGenerateRequest({
						conversationId,
						mode: "message",
						operationName: "agent.handle-message",
						input: { content },
						requestMessages: [{ role: "user", content }],
						metadata,
						onReply,
						onTextDelta,
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent message handling failed", cause: e }),
						),
					),

				handleBatchedMessages: (conversationId, messages, metadata, onReply, onTextDelta) =>
					runGenerateRequest({
						conversationId,
						mode: "batched-message",
						operationName: "agent.handle-batched-messages",
						input: { messages },
						requestMessages: messages.map((content) => ({ role: "user" as const, content })),
						metadata,
						onReply,
						onTextDelta,
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
						const traceMetadata = buildTraceMetadata({
							conversationId,
							mode: "stream-message",
							historyLength: history.length,
							toolCount: Object.keys(tools).length,
							userTimezone,
							replyToolEnabled: false,
							messageCount: 1,
						})
						const lifecycle = createLifecycleCallbacks(traceMetadata)
						const agent = createOrchestrator(systemPrompt, tools as ToolSet)

						const result = yield* Effect.tryPromise({
							try: () =>
								traceBraintrustOperation(
									"agent.stream-message",
									{ content },
									traceMetadata,
									async () => {
										const stream = await agent.stream({
											messages: [...history, { role: "user" as const, content }],
											onStepFinish: lifecycle.onStepFinish,
											onFinish: lifecycle.onFinish,
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
