import type { ChannelType } from "@amby/channels"
import { createComputerTools, createCuaTools, SandboxService, TaskSupervisor } from "@amby/computer"
import { and, DbService, desc, eq, isNotNull, ne, schema } from "@amby/db"
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
import {
	generateSynopsis,
	messageThreadFilter,
	type ResolveThreadResult,
	resolveThread,
} from "./router"
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

const THREAD_TAIL_LIMIT = 20
const ARTIFACT_MSG_LIMIT = 5
const OTHER_THREAD_CAP = 5
const DORMANT_MS = 60 * 60 * 1000

function formatArtifactRecap(
	rows: ReadonlyArray<{ toolResults: unknown; content: string }>,
	threadLabel: string | null,
): string {
	const bullets: string[] = []
	for (const row of rows) {
		const tr = row.toolResults
		if (Array.isArray(tr)) {
			for (const item of tr) {
				if (typeof item === "object" && item !== null && "output" in item) {
					const output = (item as { output?: unknown }).output
					if (typeof output === "object" && output !== null) {
						const rec = output as Record<string, unknown>
						if (typeof rec.summary === "string" && rec.summary.trim()) {
							bullets.push(rec.summary.trim())
							continue
						}
					}
					if (typeof output === "string" && output.trim()) {
						const s = output.length > 400 ? `${output.slice(0, 400)}…` : output
						bullets.push(s.trim())
					}
				}
			}
		}
	}
	if (bullets.length === 0) return ""
	const title = threadLabel?.trim() || "this topic"
	return `## Thread context (${title})\n${bullets.map((b) => `- ${b}`).join("\n")}`
}

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
			const env = yield* EnvService
			const enableCua = env.ENABLE_CUA
			initializeBraintrust(env.BRAINTRUST_API_KEY, env.BRAINTRUST_PROJECT_ID)
			const baseModel = models.getModel()

			const computer = createComputerTools(sandbox, userId)

			const loadThreadTail = (
				conversationId: string,
				threadId: string,
				defaultThreadId: string,
				limit = THREAD_TAIL_LIMIT,
			) =>
				query((d) =>
					d
						.select({ role: schema.messages.role, content: schema.messages.content })
						.from(schema.messages)
						.where(messageThreadFilter(conversationId, threadId, defaultThreadId))
						.orderBy(desc(schema.messages.createdAt))
						.limit(limit),
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

			const loadOtherThreadSummaries = (conversationId: string, excludeThreadId: string) =>
				query((d) =>
					d
						.select({
							label: schema.conversationThreads.label,
							synopsis: schema.conversationThreads.synopsis,
						})
						.from(schema.conversationThreads)
						.where(
							and(
								eq(schema.conversationThreads.conversationId, conversationId),
								eq(schema.conversationThreads.status, "open"),
								ne(schema.conversationThreads.id, excludeThreadId),
							),
						)
						.orderBy(desc(schema.conversationThreads.lastActiveAt))
						.limit(OTHER_THREAD_CAP),
				).pipe(
					Effect.map((rows) => {
						const lines = rows
							.map((r) => {
								const label = r.label?.trim() || "Untitled"
								const syn = r.synopsis?.trim() || "(no summary yet)"
								return `- **${label}**: ${syn}`
							})
							.join("\n")
						return lines.length ? `## Other active threads\n${lines}` : ""
					}),
				)

			const loadThreadArtifacts = (
				conversationId: string,
				threadId: string,
				defaultThreadId: string,
				threadLabel: string | null,
			) =>
				query((d) =>
					d
						.select({
							toolResults: schema.messages.toolResults,
							content: schema.messages.content,
						})
						.from(schema.messages)
						.where(
							and(
								messageThreadFilter(conversationId, threadId, defaultThreadId),
								eq(schema.messages.role, "assistant"),
								isNotNull(schema.messages.toolResults),
							),
						)
						.orderBy(desc(schema.messages.createdAt))
						.limit(ARTIFACT_MSG_LIMIT),
				).pipe(Effect.map((rows) => formatArtifactRecap(rows, threadLabel)))

			const saveMessage = (
				conversationId: string,
				role: "user" | "assistant" | "system" | "tool",
				content: string,
				opts?: {
					metadata?: Record<string, unknown>
					threadId?: string
					toolCalls?: unknown[]
					toolResults?: unknown[]
				},
			) =>
				query((d) =>
					d.insert(schema.messages).values({
						conversationId,
						role,
						content,
						threadId: opts?.threadId,
						metadata: opts?.metadata,
						toolCalls: opts?.toolCalls,
						toolResults: opts?.toolResults,
					}),
				)

			const maybeSaveAssistantMessage = (
				conversationId: string,
				content: string,
				opts?: {
					threadId?: string
					toolCalls?: unknown[]
					toolResults?: unknown[]
				},
			) => (content.trim() ? saveMessage(conversationId, "assistant", content, opts) : Effect.void)

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

			const prepareContext = (
				conversationId: string,
				threadCtx: ResolveThreadResult,
				onReply?: ReplyFn,
			) =>
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

					const threadRow = yield* query((d) =>
						d
							.select({
								label: schema.conversationThreads.label,
								synopsis: schema.conversationThreads.synopsis,
							})
							.from(schema.conversationThreads)
							.where(eq(schema.conversationThreads.id, threadCtx.threadId))
							.limit(1),
					)
					const threadLabel = threadRow[0]?.label ?? null
					const threadSynopsis = threadRow[0]?.synopsis?.trim() ?? ""

					const history = yield* loadThreadTail(
						conversationId,
						threadCtx.threadId,
						threadCtx.defaultThreadId,
					)
					const otherThreads = yield* loadOtherThreadSummaries(conversationId, threadCtx.threadId)
					const artifactRecap = yield* loadThreadArtifacts(
						conversationId,
						threadCtx.threadId,
						threadCtx.defaultThreadId,
						threadLabel,
					)

					const threadSynopsisBlock =
						threadCtx.threadWasDormant && threadSynopsis
							? `## Resumed thread synopsis\n${threadSynopsis}`
							: ""

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

					const extraBlocks = [
						otherThreads,
						threadSynopsisBlock,
						artifactRecap.trim() ? artifactRecap : "",
					]
						.filter(Boolean)
						.join("\n\n")

					const systemPromptWithMemory = memoryContext
						? `${basePrompt}\n\n# User Memory Context\n${memoryContext}`
						: basePrompt
					const systemPrompt = extraBlocks
						? `${systemPromptWithMemory}\n\n${extraBlocks}`
						: systemPromptWithMemory

					const sharedContext = [
						memoryContext ? `# User Memory Context\n${memoryContext}` : "",
						extraBlocks,
						`# Current Date/Time\n${formatted} (${userTimezone})`,
					]
						.filter(Boolean)
						.join("\n\n")

					const delegationTools = createSubagentTools(baseModel, toolGroups, sharedContext)

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
				threadCtx,
			}: {
				conversationId: string
				mode: RequestMode
				historyLength: number
				toolCount: number
				userTimezone: string
				replyToolEnabled: boolean
				messageCount: number
				requestMetadata?: Record<string, unknown>
				threadCtx?: ResolveThreadResult
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
					threadId: threadCtx?.threadId,
					routerAction: threadCtx?.decision.action,
					routerConfidence: threadCtx?.decision.confidence,
					threadMessageCount: threadCtx?.threadMessageCount,
				})

			const createOrchestrator = (systemPrompt: string, tools: ToolSet) =>
				new ToolLoopAgent({
					model: baseModel,
					instructions: systemPrompt,
					tools,
					stopWhen: stepCountIs(10),
				})

			const createLifecycleCallbacks = (
				traceMetadata: Record<string, unknown>,
				aggregatedToolCalls: unknown[],
			) => {
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
						const calls = toolCalls as unknown[] | undefined
						if (calls?.length) {
							aggregatedToolCalls.push(...calls)
						}
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

			const fetchTranscriptForSynopsis = (
				conversationId: string,
				threadId: string,
				defaultThreadId: string,
			) =>
				query((d) =>
					d
						.select({ role: schema.messages.role, content: schema.messages.content })
						.from(schema.messages)
						.where(messageThreadFilter(conversationId, threadId, defaultThreadId))
						.orderBy(desc(schema.messages.createdAt))
						.limit(THREAD_TAIL_LIMIT),
				).pipe(
					Effect.map((rows) =>
						rows
							.reverse()
							.map((m) => `${m.role}: ${m.content}`)
							.join("\n"),
					),
				)

			const persistThreadSynopsis = (threadId: string, synopsis: string) =>
				query((d) =>
					d
						.update(schema.conversationThreads)
						.set({ synopsis })
						.where(eq(schema.conversationThreads.id, threadId)),
				)

			const synopsisPreviousThreadIfDormantSwitch = (
				conversationId: string,
				threadCtx: ResolveThreadResult,
			) =>
				Effect.gen(function* () {
					const switchedAway =
						threadCtx.previousLastThreadId !== threadCtx.threadId &&
						(threadCtx.decision.action === "switch" || threadCtx.decision.action === "new")

					if (!switchedAway) return

					const lastRows = yield* query((d) =>
						d
							.select({ createdAt: schema.messages.createdAt })
							.from(schema.messages)
							.where(
								messageThreadFilter(
									conversationId,
									threadCtx.previousLastThreadId,
									threadCtx.defaultThreadId,
								),
							)
							.orderBy(desc(schema.messages.createdAt))
							.limit(1),
					)
					const lastAt = lastRows[0]?.createdAt
					if (!lastAt || Date.now() - lastAt.getTime() <= DORMANT_MS) return

					const transcript = yield* fetchTranscriptForSynopsis(
						conversationId,
						threadCtx.previousLastThreadId,
						threadCtx.defaultThreadId,
					)
					if (!transcript.trim()) return

					const synopsis = yield* Effect.tryPromise({
						try: () => generateSynopsis(baseModel, transcript),
						catch: (cause) =>
							new AgentError({ message: "Synopsis generation failed (previous thread)", cause }),
					})
					yield* persistThreadSynopsis(threadCtx.previousLastThreadId, synopsis)
				}).pipe(Effect.catchAll(() => Effect.void))

			const synopsisCurrentThreadIfOverflowsAfterSave = (
				conversationId: string,
				threadCtx: ResolveThreadResult,
				inboundMessageCount: number,
			) =>
				Effect.gen(function* () {
					const projectedCount = threadCtx.threadMessageCount + inboundMessageCount
					if (projectedCount <= THREAD_TAIL_LIMIT) return

					const transcript = yield* fetchTranscriptForSynopsis(
						conversationId,
						threadCtx.threadId,
						threadCtx.defaultThreadId,
					)
					if (!transcript.trim()) return

					const synopsis = yield* Effect.tryPromise({
						try: () => generateSynopsis(baseModel, transcript),
						catch: (cause) =>
							new AgentError({ message: "Synopsis generation failed (tail overflow)", cause }),
					})
					yield* persistThreadSynopsis(threadCtx.threadId, synopsis)
				}).pipe(Effect.catchAll(() => Effect.void))

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
					const inboundText = requestMessages.map((m) => m.content).join("\n\n")
					const threadCtx = yield* resolveThread(query, conversationId, inboundText, baseModel)

					yield* synopsisPreviousThreadIfDormantSwitch(conversationId, threadCtx)

					const { tools, systemPrompt, history, userTimezone } = yield* prepareContext(
						conversationId,
						threadCtx,
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
						threadCtx,
					})
					const aggregatedToolCalls: unknown[] = []
					const lifecycle = createLifecycleCallbacks(traceMetadata, aggregatedToolCalls)
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
									: async () => {
											const genResult = await agent.generate({
												messages: [...history, ...requestMessages],
												onStepFinish: lifecycle.onStepFinish,
												onFinish: lifecycle.onFinish,
											})
											return {
												text: genResult.text,
												toolResults: genResult.toolResults,
											}
										},
								(response) => ({ text: response.text }),
							),
						catch: (cause) => new AgentError({ message: "Failed to generate response", cause }),
					})
					const toolUserMessages = onReply ? extractLastToolUserMessages(result) : undefined
					if (toolUserMessages && onReply) {
						yield* sendToolUserMessages(toolUserMessages, onReply)
					}
					const finalText = toolUserMessages ? "" : result.text

					const toolResultsPersist = result.toolResults?.length
						? [...result.toolResults]
						: undefined

					const threadMeta = {
						threadId: threadCtx.threadId,
						router: {
							action: threadCtx.decision.action,
							confidence: threadCtx.decision.confidence,
						},
					}
					const userMetadata = metadata ? { ...metadata, ...threadMeta } : threadMeta

					for (const message of requestMessages) {
						yield* saveMessage(conversationId, "user", message.content, {
							metadata: userMetadata,
							threadId: threadCtx.threadId,
						})
					}
					yield* maybeSaveAssistantMessage(conversationId, finalText, {
						threadId: threadCtx.threadId,
						toolCalls: aggregatedToolCalls.length > 0 ? aggregatedToolCalls : undefined,
						toolResults: toolResultsPersist,
					})

					yield* synopsisCurrentThreadIfOverflowsAfterSave(
						conversationId,
						threadCtx,
						requestMessages.length + 1,
					)

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
						const threadCtx = yield* resolveThread(query, conversationId, content, baseModel)

						yield* synopsisPreviousThreadIfDormantSwitch(conversationId, threadCtx)

						const { tools, systemPrompt, history, userTimezone } = yield* prepareContext(
							conversationId,
							threadCtx,
						)
						const traceMetadata = buildTraceMetadata({
							conversationId,
							mode: "stream-message",
							historyLength: history.length,
							toolCount: Object.keys(tools).length,
							userTimezone,
							replyToolEnabled: false,
							messageCount: 1,
							threadCtx,
						})
						const aggregatedToolCalls: unknown[] = []
						const lifecycle = createLifecycleCallbacks(traceMetadata, aggregatedToolCalls)
						const agent = createOrchestrator(systemPrompt, tools as ToolSet)

						const { text: result, toolResults } = yield* Effect.tryPromise({
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

										const [text, tr] = await Promise.all([stream.text, stream.toolResults])
										return { text, toolResults: tr }
									},
									({ text }) => ({ text }),
								),
							catch: (cause) => new AgentError({ message: "Failed to stream response", cause }),
						})

						const threadMeta = {
							threadId: threadCtx.threadId,
							router: {
								action: threadCtx.decision.action,
								confidence: threadCtx.decision.confidence,
							},
						}
						yield* saveMessage(conversationId, "user", content, {
							metadata: threadMeta,
							threadId: threadCtx.threadId,
						})
						yield* saveMessage(conversationId, "assistant", result, {
							threadId: threadCtx.threadId,
							toolCalls: aggregatedToolCalls.length > 0 ? aggregatedToolCalls : undefined,
							toolResults: toolResults ? [...toolResults] : undefined,
						})

						yield* synopsisCurrentThreadIfOverflowsAfterSave(conversationId, threadCtx, 2)

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
