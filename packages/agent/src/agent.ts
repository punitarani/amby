import type { ChannelType } from "@amby/channels"
import { createComputerTools, createCuaTools, SandboxService, TaskSupervisor } from "@amby/computer"
import { ConnectorsService, createConnectorManagementTools } from "@amby/connectors"
import { and, DbService, desc, eq, isNotNull, ne, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import {
	buildMemoriesText,
	createMemoryTools,
	deduplicateMemories,
	MemoryService,
} from "@amby/memory"
import { ModelService } from "@amby/models"
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai"
import { Context, Effect, Layer } from "effect"
import { AgentError } from "./errors"
import {
	type AgentConfig,
	type AgentTraceMetadata,
	buildRequestTraceMetadata,
	createTelemetrySettings,
	initializeTelemetry,
	shutdownTelemetry,
	type TraceRequestMode,
	withTelemetryFlush,
} from "./telemetry"

export type StreamPart =
	| { type: "text-delta"; text: string }
	| { type: "tool-call"; toolName: string; args: Record<string, unknown> }
	| { type: "tool-result"; toolName: string; result: unknown }

const ORCHESTRATOR_MAX_STEPS = 14

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
import { extractToolUserMessages } from "./utils/extract-tool-user-messages"

const THREAD_TAIL_LIMIT = 20
const ARTIFACT_MSG_LIMIT = 5
const OTHER_THREAD_CAP = 5
const DORMANT_MS = 60 * 60 * 1000
const RECENT_WITH_TOOLS = 4

type TraceData = {
	toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>
	toolResults?: Array<{ toolCallId: string; toolName: string; output: unknown }>
}

export function extractTraceData(
	steps: ReadonlyArray<{
		toolCalls: ReadonlyArray<{ toolCallId: string; toolName: string; input: unknown }>
		toolResults: ReadonlyArray<{
			toolCallId: string
			toolName: string
			output: unknown
		}>
	}>,
): TraceData {
	const toolCalls = steps.flatMap((s) =>
		s.toolCalls.map((tc) => ({
			toolCallId: tc.toolCallId,
			toolName: tc.toolName,
			input: tc.input,
		})),
	)
	const toolResults = steps.flatMap((s) =>
		s.toolResults.map((tr) => ({
			toolCallId: tr.toolCallId,
			toolName: tr.toolName,
			output: summarizeToolOutput(tr.output),
		})),
	)
	return {
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		toolResults: toolResults.length > 0 ? toolResults : undefined,
	}
}

export function summarizeToolOutput(output: unknown): unknown {
	if (typeof output === "object" && output !== null && "summary" in output) {
		return output
	}
	if (typeof output === "string") {
		if (output.length <= 500) return output
		const cutPoint = output.lastIndexOf(" ", 500)
		const safePoint = cutPoint > 400 ? cutPoint : 500
		return `${output.slice(0, safePoint)}…`
	}
	return output
}

function buildThreadMeta(threadCtx: ResolveThreadResult) {
	return {
		threadId: threadCtx.threadId,
		router: {
			action: threadCtx.decision.action,
			confidence: threadCtx.decision.confidence,
		},
	}
}

export function formatToolAnnotation(toolResults: unknown[]): string {
	if (toolResults.length === 0) return ""
	const parts = toolResults.map((tr: unknown) => {
		const item = tr as { toolName?: string; output?: unknown }
		const name = item.toolName ?? "unknown"
		const summary =
			typeof item.output === "object" && item.output !== null && "summary" in item.output
				? String((item.output as { summary: unknown }).summary).slice(0, 200)
				: ""
		return summary ? `${name}: ${summary}` : name
	})
	return `[Tools used: ${parts.join("; ")}]`
}

export function buildReplayMessages(
	rows: Array<{
		role: string
		content: string
		toolCalls: unknown
		toolResults: unknown
	}>,
): Array<{ role: "user" | "assistant"; content: string }> {
	const filtered = rows.filter(
		(
			r,
		): r is {
			role: "user" | "assistant"
			content: string
			toolCalls: unknown
			toolResults: unknown
		} => r.role === "user" || r.role === "assistant",
	)
	const recentStart = Math.max(0, filtered.length - RECENT_WITH_TOOLS)
	return filtered.map((row, i) => {
		if (i < recentStart || row.role !== "assistant" || !Array.isArray(row.toolResults)) {
			return { role: row.role, content: row.content }
		}
		const annotation = formatToolAnnotation(row.toolResults)
		return {
			role: row.role,
			content: annotation ? `${row.content}\n\n${annotation}` : row.content,
		}
	})
}

export function formatArtifactRecap(
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
			const connectors = yield* ConnectorsService
			const env = yield* EnvService
			initializeTelemetry({
				apiKey: env.BRAINTRUST_API_KEY,
				projectId: env.BRAINTRUST_PROJECT_ID,
			})
			const baseModel = models.getModel()
			const agentConfig: AgentConfig = {
				userId,
				modelId: models.defaultModelId,
				cuaEnabled: env.ENABLE_CUA,
			}

			const computer = createComputerTools(sandbox, userId)

			const loadThreadTail = (
				conversationId: string,
				threadId: string,
				defaultThreadId: string,
				limit = THREAD_TAIL_LIMIT,
			) =>
				query((d) =>
					d
						.select({
							role: schema.messages.role,
							content: schema.messages.content,
							toolCalls: schema.messages.toolCalls,
							toolResults: schema.messages.toolResults,
						})
						.from(schema.messages)
						.where(messageThreadFilter(conversationId, threadId, defaultThreadId))
						.orderBy(desc(schema.messages.createdAt))
						.limit(limit),
				).pipe(Effect.map((rows) => buildReplayMessages(rows.reverse())))

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
						? createSandboxDelegationTools(taskSupervisor, userId, conversationId)
						: undefined
					const codexAuthTools = sandbox.enabled
						? createCodexAuthTools(taskSupervisor, userId)
						: undefined
					const cuaTools = agentConfig.cuaEnabled
						? createCuaTools(sandbox, userId, conversationId, computer.getSandbox).tools
						: undefined
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
					const integrationTools =
						connectorManagementTools || connectorSessionTools
							? ({
									...(connectorManagementTools ?? {}),
									...(connectorSessionTools ?? {}),
								} as ToolSet)
							: undefined
					const toolGroups = buildToolGroups(
						memoryTools,
						computer.tools,
						cuaTools,
						integrationTools,
					)

					const basePrompt = agentConfig.cuaEnabled
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
					const systemPrompt =
						extraBlocks.length > 0
							? `${systemPromptWithMemory}\n\n${extraBlocks}`
							: systemPromptWithMemory

					// extraBlocks is a pre-joined string of thread context sections (empty string filtered by .filter(Boolean))
					const sharedPromptContext = [
						memoryContext ? `# User Memory Context\n${memoryContext}` : "",
						extraBlocks,
						`# Current Date/Time\n${formatted} (${userTimezone})`,
					]
						.filter(Boolean)
						.join("\n\n")

					const { search_memories } = memoryTools
					const tools = {
						search_memories,
						...(sandboxTools ?? {}),
						...(codexAuthTools ?? {}),
						...createJobTools(db, userId, userTimezone),
						...(onReply ? createReplyTools(onReply) : {}),
					}

					return { tools, systemPrompt, history, userTimezone, sharedPromptContext, toolGroups }
				})

			const createOrchestrator = (
				systemPrompt: string,
				tools: ToolSet,
				functionId: "amby.orchestrator.generate" | "amby.orchestrator.stream",
				conversationTraceMetadata: AgentTraceMetadata,
			) =>
				new ToolLoopAgent({
					id: "orchestrator",
					model: baseModel,
					instructions: systemPrompt,
					tools,
					// Delegation-heavy turns, especially connected-app work, need extra
					// roundtrips on top of the base agent steps.
					stopWhen: stepCountIs(ORCHESTRATOR_MAX_STEPS),
					experimental_telemetry: createTelemetrySettings({
						functionId,
						metadata: conversationTraceMetadata,
					}),
				})

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
				requestMessages,
				metadata,
				onReply,
				onTextDelta,
			}: {
				conversationId: string
				mode: Extract<TraceRequestMode, "message" | "batched-message">
				requestMessages: ReadonlyArray<{ role: "user"; content: string }>
				metadata?: Record<string, unknown>
				onReply?: ReplyFn
				onTextDelta?: (text: string) => void
			}) =>
				withTelemetryFlush(
					Effect.gen(function* () {
						const inboundText = requestMessages.map((m) => m.content).join("\n\n")
						const threadCtx = yield* resolveThread(query, conversationId, inboundText, baseModel)

						yield* synopsisPreviousThreadIfDormantSwitch(conversationId, threadCtx)

						const { tools, systemPrompt, history, sharedPromptContext, toolGroups } =
							yield* prepareContext(conversationId, threadCtx, onReply)
						const requestTraceMetadata = buildRequestTraceMetadata({
							conversationId,
							requestMode: mode,
							requestMetadata: metadata,
						})
						const delegationTools = createSubagentTools(
							models.getModel,
							toolGroups,
							sharedPromptContext,
							agentConfig,
							requestTraceMetadata,
						)
						const orchestratorMetadata: AgentTraceMetadata = {
							...requestTraceMetadata,
							user_id: agentConfig.userId,
							model_id: agentConfig.modelId,
							cua_enabled: agentConfig.cuaEnabled,
							agent_role: "orchestrator",
							agent_name: "orchestrator",
						}
						const agent = createOrchestrator(
							systemPrompt,
							{ ...delegationTools, ...tools } as ToolSet,
							"amby.orchestrator.generate",
							orchestratorMetadata,
						)

						const result = yield* Effect.tryPromise({
							try: async () => {
								if (onTextDelta) {
									const stream = await agent.stream({
										messages: [...history, ...requestMessages],
									})
									for await (const part of stream.fullStream) {
										if (part.type === "text-delta") {
											onTextDelta(part.text)
										}
									}
									const [text, toolResults, steps] = await Promise.all([
										stream.text,
										stream.toolResults,
										stream.steps,
									])
									return { text, toolResults, steps }
								}
								return await agent.generate({
									messages: [...history, ...requestMessages],
								})
							},
							catch: (cause) => new AgentError({ message: "Failed to generate response", cause }),
						})
						const toolUserMessages = onReply
							? extractToolUserMessages(result.toolResults)
							: undefined
						if (toolUserMessages && onReply) {
							yield* sendToolUserMessages(toolUserMessages, onReply)
						}
						const finalText = toolUserMessages ? "" : result.text

						const threadMeta = buildThreadMeta(threadCtx)
						const userMetadata = metadata ? { ...metadata, ...threadMeta } : threadMeta
						const trace = extractTraceData(result.steps ?? [])

						for (const message of requestMessages) {
							yield* saveMessage(conversationId, "user", message.content, {
								metadata: userMetadata,
								threadId: threadCtx.threadId,
							})
						}
						yield* maybeSaveAssistantMessage(conversationId, finalText, {
							threadId: threadCtx.threadId,
							toolCalls: trace.toolCalls,
							toolResults: trace.toolResults,
						})

						yield* synopsisCurrentThreadIfOverflowsAfterSave(
							conversationId,
							threadCtx,
							requestMessages.length + 1,
						)

						return finalText
					}),
				)

			return {
				handleMessage: (conversationId, content, metadata, onReply, onTextDelta) =>
					runGenerateRequest({
						conversationId,
						mode: "message",
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
					withTelemetryFlush(
						Effect.gen(function* () {
							const threadCtx = yield* resolveThread(query, conversationId, content, baseModel)

							yield* synopsisPreviousThreadIfDormantSwitch(conversationId, threadCtx)

							const { tools, systemPrompt, history, sharedPromptContext, toolGroups } =
								yield* prepareContext(conversationId, threadCtx)
							const requestTraceMetadata = buildRequestTraceMetadata({
								conversationId,
								requestMode: "stream-message",
							})
							const delegationTools = createSubagentTools(
								models.getModel,
								toolGroups,
								sharedPromptContext,
								agentConfig,
								requestTraceMetadata,
							)
							const orchestratorMetadata: AgentTraceMetadata = {
								...requestTraceMetadata,
								user_id: agentConfig.userId,
								model_id: agentConfig.modelId,
								cua_enabled: agentConfig.cuaEnabled,
								agent_role: "orchestrator",
								agent_name: "orchestrator",
							}
							const agent = createOrchestrator(
								systemPrompt,
								{ ...delegationTools, ...tools } as ToolSet,
								"amby.orchestrator.stream",
								orchestratorMetadata,
							)

							const result = yield* Effect.tryPromise({
								try: async () => {
									const stream = await agent.stream({
										messages: [...history, { role: "user" as const, content }],
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

									const [text, steps] = await Promise.all([stream.text, stream.steps])
									return { text, steps }
								},
								catch: (cause) => new AgentError({ message: "Failed to stream response", cause }),
							})

							const threadMeta = buildThreadMeta(threadCtx)
							const trace = extractTraceData(result.steps ?? [])
							yield* saveMessage(conversationId, "user", content, {
								metadata: threadMeta,
								threadId: threadCtx.threadId,
							})
							yield* saveMessage(conversationId, "assistant", result.text, {
								threadId: threadCtx.threadId,
								toolCalls: trace.toolCalls,
								toolResults: trace.toolResults,
							})

							yield* synopsisCurrentThreadIfOverflowsAfterSave(conversationId, threadCtx, 2)

							return result.text
						}),
					).pipe(
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
							try: () => shutdownTelemetry(),
							catch: (cause) => new AgentError({ message: "Failed to shut down telemetry", cause }),
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
