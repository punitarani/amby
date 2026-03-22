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
	DORMANT_MS,
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
const RECENT_WITH_TOOLS = 4
const SUMMARY_TRUNCATE = 200
const ARTIFACT_TRUNCATE = 400
const TOOL_OUTPUT_TRUNCATE = 500

type TraceData = {
	toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>
	toolResults?: Array<{ toolCallId: string; toolName: string; output: unknown }>
}

export function extractTraceSummary(
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

/** @deprecated Use extractTraceSummary instead */
export const extractTraceData = extractTraceSummary

export function summarizeToolOutput(output: unknown): unknown {
	if (typeof output === "object" && output !== null && "summary" in output) {
		return output
	}
	if (typeof output === "string") {
		if (output.length <= TOOL_OUTPUT_TRUNCATE) return output
		const cutPoint = output.lastIndexOf(" ", TOOL_OUTPUT_TRUNCATE)
		const safePoint = cutPoint > TOOL_OUTPUT_TRUNCATE - 100 ? cutPoint : TOOL_OUTPUT_TRUNCATE
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
		if (typeof tr !== "object" || tr === null) return "unknown"
		const name = "toolName" in tr && typeof tr.toolName === "string" ? tr.toolName : "unknown"
		const output = "output" in tr ? tr.output : undefined
		const summary =
			typeof output === "object" &&
			output !== null &&
			"summary" in output &&
			typeof output.summary === "string"
				? output.summary.slice(0, SUMMARY_TRUNCATE)
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
				if (typeof item !== "object" || item === null || !("output" in item)) continue
				const output = item.output
				if (
					typeof output === "object" &&
					output !== null &&
					"summary" in output &&
					typeof output.summary === "string" &&
					output.summary.trim()
				) {
					bullets.push(output.summary.trim())
					continue
				}
				if (typeof output === "string" && output.trim()) {
					const s =
						output.length > ARTIFACT_TRUNCATE ? `${output.slice(0, ARTIFACT_TRUNCATE)}…` : output
					bullets.push(s.trim())
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

			const loadRawArtifacts = (
				conversationId: string,
				threadId: string,
				defaultThreadId: string,
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
				)

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
					d
						.insert(schema.messages)
						.values({
							conversationId,
							role,
							content,
							threadId: opts?.threadId,
							metadata: opts?.metadata,
							toolCalls: opts?.toolCalls,
							toolResults: opts?.toolResults,
						})
						.returning({ id: schema.messages.id }),
				)

			const maybeSaveAssistantMessage = (
				conversationId: string,
				content: string,
				opts?: {
					threadId?: string
					toolCalls?: unknown[]
					toolResults?: unknown[]
				},
			) =>
				content.trim()
					? saveMessage(conversationId, "assistant", content, opts)
					: Effect.succeed([])

			const persistTraces = (
				messageId: string,
				steps: ReadonlyArray<{
					toolCalls: ReadonlyArray<{
						toolCallId: string
						toolName: string
						input: unknown
					}>
					toolResults: ReadonlyArray<{
						toolCallId: string
						toolName: string
						output: unknown
					}>
				}>,
			) =>
				Effect.gen(function* () {
					const orchCalls = steps.flatMap((s) =>
						s.toolCalls.map((tc) => ({
							toolCallId: tc.toolCallId,
							toolName: tc.toolName,
							input: tc.input,
						})),
					)
					const orchResults = steps.flatMap((s) =>
						s.toolResults.map((tr) => ({
							toolCallId: tr.toolCallId,
							toolName: tr.toolName,
							output: tr.output,
						})),
					)

					// Insert orchestrator trace
					const orchRows = yield* query((d) =>
						d
							.insert(schema.traces)
							.values({
								messageId,
								agentName: "orchestrator",
								toolCalls: orchCalls.length ? orchCalls : null,
								toolResults: orchResults.length ? orchResults : null,
							})
							.returning({ id: schema.traces.id }),
					)
					const orchRow = orchRows[0]
					if (!orchRow) return

					// Extract subagent traces from delegate_* results
					const subTraces = orchResults
						.filter(
							(tr) =>
								tr.toolName.startsWith("delegate_") &&
								typeof tr.output === "object" &&
								tr.output !== null &&
								"_trace" in tr.output,
						)
						.map(
							(tr) =>
								(
									tr.output as {
										_trace: {
											agentName: string
											steps: Array<{
												toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
												toolResults: Array<{
													toolCallId: string
													toolName: string
													output: unknown
												}>
											}>
											durationMs: number
										}
									}
								)._trace,
						)

					if (subTraces.length > 0) {
						yield* query((d) =>
							d.insert(schema.traces).values(
								subTraces.map((t) => ({
									messageId,
									parentTraceId: orchRow.id,
									agentName: t.agentName,
									toolCalls: t.steps.flatMap((s) => s.toolCalls),
									toolResults: t.steps.flatMap((s) => s.toolResults),
									durationMs: t.durationMs,
								})),
							),
						)
					}
				}).pipe(
					Effect.catchAll((e) =>
						Effect.sync(() => {
							console.warn("[Traces] Persistence failed:", e)
						}),
					),
				)

			const prepareContext = (
				conversationId: string,
				threadCtx: ResolveThreadResult,
				onReply?: ReplyFn,
			) =>
				Effect.gen(function* () {
					// Parallel: user row + profile
					const [userRow, profile] = yield* Effect.all(
						[
							query((d) =>
								d
									.select({ timezone: schema.users.timezone })
									.from(schema.users)
									.where(eq(schema.users.id, userId))
									.limit(1),
							),
							memory.getProfile(userId),
						],
						{ concurrency: 2 },
					)
					const userTimezone = userRow[0]?.timezone ?? "UTC"

					const formatted = new Intl.DateTimeFormat("en-US", {
						timeZone: userTimezone,
						dateStyle: "full",
						timeStyle: "long",
					}).format(new Date())

					const deduped = deduplicateMemories(profile.static, profile.dynamic)
					const memoryContext = buildMemoriesText(deduped)

					// Parallel: thread metadata, history, other threads, artifacts
					const [threadRow, history, otherThreads, artifactRows] = yield* Effect.all(
						[
							query((d) =>
								d
									.select({
										label: schema.conversationThreads.label,
										synopsis: schema.conversationThreads.synopsis,
									})
									.from(schema.conversationThreads)
									.where(eq(schema.conversationThreads.id, threadCtx.threadId))
									.limit(1),
							),
							loadThreadTail(conversationId, threadCtx.threadId, threadCtx.defaultThreadId),
							loadOtherThreadSummaries(conversationId, threadCtx.threadId),
							loadRawArtifacts(conversationId, threadCtx.threadId, threadCtx.defaultThreadId),
						],
						{ concurrency: 4 },
					)

					const threadLabel = threadRow[0]?.label ?? null
					const threadSynopsis = threadRow[0]?.synopsis?.trim() ?? ""
					const artifactRecap = formatArtifactRecap(artifactRows, threadLabel)

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

					const contextSections = [otherThreads, threadSynopsisBlock, artifactRecap].filter(Boolean)
					const extraContext = contextSections.join("\n\n")

					const systemPrompt = [
						basePrompt,
						memoryContext ? `# User Memory Context\n${memoryContext}` : "",
						extraContext,
					]
						.filter(Boolean)
						.join("\n\n")

					const sharedPromptContext = [
						memoryContext ? `# User Memory Context\n${memoryContext}` : "",
						extraContext,
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

			const maybeGenerateSynopsis = (
				threadId: string,
				conversationId: string,
				defaultThreadId: string,
			) =>
				Effect.gen(function* () {
					const transcript = yield* fetchTranscriptForSynopsis(
						conversationId,
						threadId,
						defaultThreadId,
					)
					if (!transcript.trim()) return

					const { synopsis, keywords } = yield* Effect.tryPromise({
						try: () => generateSynopsis(baseModel, transcript),
						catch: (cause) => new AgentError({ message: "Synopsis generation failed", cause }),
					})
					yield* query((d) =>
						d
							.update(schema.conversationThreads)
							.set({ synopsis, keywords })
							.where(eq(schema.conversationThreads.id, threadId)),
					)
				}).pipe(
					Effect.catchAll((e) =>
						Effect.sync(() => {
							console.warn("[Synopsis] Failed:", e)
						}),
					),
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

					yield* maybeGenerateSynopsis(
						threadCtx.previousLastThreadId,
						conversationId,
						threadCtx.defaultThreadId,
					)
				}).pipe(Effect.catchAll(() => Effect.void))

			const synopsisCurrentThreadIfOverflowsAfterSave = (
				conversationId: string,
				threadCtx: ResolveThreadResult,
				inboundMessageCount: number,
			) =>
				Effect.gen(function* () {
					const projectedCount = threadCtx.threadMessageCount + inboundMessageCount
					if (projectedCount <= THREAD_TAIL_LIMIT) return

					yield* maybeGenerateSynopsis(
						threadCtx.threadId,
						conversationId,
						threadCtx.defaultThreadId,
					)
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
				onPart,
			}: {
				conversationId: string
				mode: TraceRequestMode
				requestMessages: ReadonlyArray<{ role: "user"; content: string }>
				metadata?: Record<string, unknown>
				onReply?: ReplyFn
				onTextDelta?: (text: string) => void
				onPart?: (part: StreamPart) => void
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
						const functionId = onPart ? "amby.orchestrator.stream" : "amby.orchestrator.generate"
						const agent = createOrchestrator(
							systemPrompt,
							{ ...delegationTools, ...tools } as ToolSet,
							functionId as "amby.orchestrator.generate" | "amby.orchestrator.stream",
							orchestratorMetadata,
						)

						const messages = onPart
							? [
									...history,
									...requestMessages.map((m) => ({ role: "user" as const, content: m.content })),
								]
							: [...history, ...requestMessages]

						const result = yield* Effect.tryPromise({
							try: async () => {
								if (onPart || onTextDelta) {
									const stream = await agent.stream({ messages })

									for await (const part of stream.fullStream) {
										switch (part.type) {
											case "text-delta":
												if (onTextDelta) onTextDelta(part.text)
												if (onPart) onPart({ type: "text-delta", text: part.text })
												break
											case "tool-call":
												if (onPart) {
													onPart({
														type: "tool-call",
														toolName: part.toolName,
														args: part.input as Record<string, unknown>,
													})
												}
												break
											case "tool-result":
												if (onPart) {
													onPart({
														type: "tool-result",
														toolName: part.toolName,
														result: part.output,
													})
												}
												break
										}
									}

									const [text, toolResults, steps] = await Promise.all([
										stream.text,
										stream.toolResults,
										stream.steps,
									])
									return { text, toolResults, steps }
								}
								return await agent.generate({ messages })
							},
							catch: (cause) =>
								new AgentError({
									message: onPart ? "Failed to stream response" : "Failed to generate response",
									cause,
								}),
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
						const trace = extractTraceSummary(result.steps ?? [])

						for (const message of requestMessages) {
							yield* saveMessage(conversationId, "user", message.content, {
								metadata: userMetadata,
								threadId: threadCtx.threadId,
							})
						}
						const savedRows = yield* maybeSaveAssistantMessage(conversationId, finalText, {
							threadId: threadCtx.threadId,
							toolCalls: trace.toolCalls,
							toolResults: trace.toolResults,
						})

						// Persist full traces if we have a message ID
						const savedMessageId = savedRows[0]?.id
						if (savedMessageId && result.steps?.length) {
							yield* persistTraces(savedMessageId, result.steps)
						}

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
								: new AgentError({
										message: "Agent batched message handling failed",
										cause: e,
									}),
						),
					),

				streamMessage: (conversationId, content, onPart) =>
					runGenerateRequest({
						conversationId,
						mode: "stream-message",
						requestMessages: [{ role: "user", content }],
						onPart,
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
