import type { BrowserService } from "@amby/browser"
import type { TaskSupervisor } from "@amby/computer"
import type { PluginRegistry, TaskStoreService } from "@amby/core"
import type { Database, DbError } from "@amby/db"
import { type LanguageModel, stepCountIs, ToolLoopAgent, type ToolSet, tool } from "ai"
import type { Context } from "effect"
import { Effect, Runtime } from "effect"
import { z } from "zod"
import type { prepareConversationContext } from "../context/builder"
import { AgentError } from "../errors"
import { executeRequestPlan } from "../execution/coordinator"
import { createRootTrace, type TraceWriter } from "../execution/ledger"
import { queryExecution } from "../execution/query-execution"
import type { ToolGroups } from "../execution/registry"
import { createTelemetrySettings } from "../telemetry"
import { normalizeTraceEnvironment } from "../trace-metadata"
import type { AgentRunConfig, AgentRunResult, StreamPart } from "../types/agent"
import type { QueryExecutionResult } from "../types/execution"

const CONVERSATION_MAX_STEPS = 8

function toErrorMessage(error: unknown): string {
	if (error instanceof AgentError) return error.message
	if (error instanceof Error) return error.message
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message
	}
	return String(error)
}

function summarizeExecutionOutput(output: unknown): string {
	if (output === undefined || output === null) return ""
	if (typeof output === "string") return output.trim().slice(0, 400)
	if (
		typeof output === "object" &&
		output !== null &&
		"result" in output &&
		typeof output.result === "string"
	) {
		return output.result.trim().slice(0, 400)
	}
	try {
		return JSON.stringify(output).slice(0, 400)
	} catch {
		return ""
	}
}

function buildExecutionToolSummary(
	result:
		| QueryExecutionResult
		| {
				mode: AgentRunResult["execution"]["mode"]
				tasks: AgentRunResult["execution"]["tasks"]
				backgroundTasks?: AgentRunResult["execution"]["backgroundTasks"]
		  },
): string {
	if ("executions" in result) {
		if (result.executions.length === 0) return "No matching executions found."
		return result.executions
			.map((execution) => {
				const preview = summarizeExecutionOutput(execution.output)
				const progress = execution.recentEvents
					?.filter((event) => event.kind === "task.progress" || event.kind === "task.started")
					.slice(0, 3)
					.map((event) => {
						const payload =
							event.payload && typeof event.payload === "object" ? event.payload : undefined
						const message =
							payload && "message" in payload && typeof payload.message === "string"
								? payload.message
								: null
						const phase =
							payload && "phase" in payload && typeof payload.phase === "string"
								? payload.phase
								: null
						return message ?? phase ?? event.kind
					})
					.filter(Boolean)
				const artifacts = execution.artifacts?.length
					? ` Files: ${execution.artifacts
							.map((artifact) => artifact.title ?? artifact.uri ?? artifact.kind)
							.join(", ")}.`
					: ""
				return `${execution.taskId}: ${execution.status} [${execution.runtime}/${execution.provider}]${
					execution.summary ? ` — ${execution.summary}` : ""
				}${preview ? `\nOutput preview: ${preview}` : ""}${progress?.length ? `\nRecent progress: ${progress.join(" | ")}` : ""}${artifacts}`
			})
			.join("\n")
	}

	if (result.tasks.length === 0) return "No specialist execution was required."

	const background = result.backgroundTasks?.length
		? ` Background tasks: ${result.backgroundTasks.map((task) => `${task.taskId} (${task.status})`).join(", ")}.`
		: ""

	return `Execution mode: ${result.mode}. ${result.tasks
		.map((task) => `${task.specialist}: ${task.summary}`)
		.join(" | ")}.${background}`
}

function buildConversationPrepareStep() {
	return ({ steps }: { steps: Array<{ toolCalls: Array<{ toolName: string }> }> }) => {
		const usedExecutionBoundary = steps.some((step) =>
			step.toolCalls.some(
				(toolCall) =>
					toolCall.toolName === "execute_plan" || toolCall.toolName === "query_execution",
			),
		)
		if (usedExecutionBoundary) {
			return { activeTools: [] }
		}
		return undefined
	}
}

async function flushConversationToolEvents(
	result: {
		steps?: Array<{
			toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
			toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>
		}>
	},
	trace: TraceWriter,
	rt: Runtime.Runtime<never>,
) {
	const events = (result.steps ?? []).flatMap((step) => [
		...step.toolCalls.map((toolCall) => ({
			kind: "tool_call" as const,
			payload: {
				toolCallId: toolCall.toolCallId,
				toolName: toolCall.toolName,
				input: toolCall.input,
			},
		})),
		...step.toolResults.map((toolResult) => ({
			kind: "tool_result" as const,
			payload: {
				toolCallId: toolResult.toolCallId,
				toolName: toolResult.toolName,
				output: toolResult.output,
			},
		})),
	])

	if (events.length > 0) {
		await Runtime.runPromise(rt)(trace.appendMany(events))
	}
}

export type ReplyFn = (text: string) => Promise<void>

/**
 * Configuration for the ConversationEngine.
 * All dependencies are injected — no direct imports of provider packages.
 */
export interface ConversationEngineConfig {
	readonly userId: string
	readonly defaultModelId: string
	readonly highReasoningModelId: string
	readonly routerModelId?: string
	readonly getModel: () => LanguageModel
	readonly environment: string
	readonly runtime: {
		readonly sandboxEnabled: boolean
		readonly cuaEnabled: boolean
		readonly integrationEnabled: boolean
		readonly browserEnabled: boolean
	}
	/** Build tool groups lazily — called after thread resolution so providers receive a real threadId. */
	readonly buildToolGroups: (threadId: string) => Promise<ToolGroups>
	/** DB query function for persistence. */
	readonly query: <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, DbError>
	/** Direct DB instance for raw inserts. */
	readonly db: Database
	/** Task store for run metadata persistence (decoupled from DB). */
	readonly taskStore: TaskStoreService
	/** Plugin registry for gathering context contributions. */
	readonly pluginRegistry?: PluginRegistry
	/** Prepare conversation context (memory, threads, prompts). */
	readonly prepareContext: typeof prepareConversationContext
	/** Thread resolver. */
	readonly resolveThread: typeof import("../router").resolveThread
	/** Synopsis helpers. */
	readonly synopsisPreviousThreadIfDormantSwitch: typeof import("../synopsis").synopsisPreviousThreadIfDormantSwitch
	readonly synopsisCurrentThreadIfOverflowsAfterSave: typeof import("../synopsis").synopsisCurrentThreadIfOverflowsAfterSave
	/** Browser service (for execution plan). */
	readonly browser: Context.Tag.Service<typeof BrowserService>
	/** Task supervisor (for execution plan + query). */
	readonly supervisor: Context.Tag.Service<typeof TaskSupervisor>
	/** Schema for message persistence. */
	readonly schema: typeof import("@amby/db").schema
}

export interface TurnRequest {
	readonly conversationId: string
	readonly mode: AgentRunConfig["request"]["mode"]
	readonly requestMessages: ReadonlyArray<{ role: "user"; content: string }>
	readonly metadata?: Record<string, unknown>
	readonly onReply?: ReplyFn
	readonly onTextDelta?: (text: string) => void
	readonly onPart?: (part: StreamPart) => void
}

/**
 * ConversationEngine handles a single conversation turn.
 * This is the extracted core from the old AgentService.runRequest.
 */
export function handleTurn(
	config: ConversationEngineConfig,
	request: TurnRequest,
): Effect.Effect<AgentRunResult, AgentError> {
	const { conversationId, mode, requestMessages, metadata, onReply, onTextDelta, onPart } = request
	const { userId, query } = config
	let rootTraceRef: TraceWriter | undefined

	return Effect.gen(function* () {
		const inboundText = requestMessages.map((m) => m.content).join("\n\n")
		const baseModel = config.getModel()
		const threadCtx = yield* config.resolveThread(query, conversationId, inboundText, baseModel)

		const toolGroups = yield* Effect.tryPromise({
			try: () => config.buildToolGroups(threadCtx.threadId),
			catch: (cause) => new AgentError({ message: "Failed to build tool groups", cause }),
		})

		yield* config.synopsisPreviousThreadIfDormantSwitch(query, baseModel, conversationId, threadCtx)

		// Gather plugin context contributions (memory, skills, etc.)
		let pluginContext = ""
		const registry = config.pluginRegistry
		if (registry) {
			const contributions = yield* Effect.tryPromise({
				try: () =>
					Promise.all(
						registry.contextContributors.map((c) =>
							c
								.contribute({ userId, conversationId, threadId: threadCtx.threadId })
								.catch(() => undefined),
						),
					),
				catch: () => new AgentError({ message: "Failed to gather plugin context" }),
			})
			pluginContext = contributions.filter(Boolean).join("\n\n")
		}

		const prepared = yield* config.prepareContext({
			query,
			userId,
			conversationId,
			threadCtx,
			memoryContext: pluginContext || undefined,
			runtime: config.runtime,
		})

		const runConfig = buildRunConfig({
			userId,
			conversationId,
			threadId: threadCtx.threadId,
			mode,
			environment: config.environment,
			requestMetadata: metadata,
			modelId: config.defaultModelId,
			highReasoningModelId: config.highReasoningModelId,
			routerModelId: config.routerModelId,
			userTimezone: prepared.userTimezone,
			sharedPromptContext: prepared.sharedPromptContext,
			runtime: {
				...config.runtime,
				streamingEnabled: Boolean(onPart || onTextDelta),
			},
		})

		const rootTrace = yield* createRootTrace(query, runConfig, {
			router: threadCtx.decision,
			requestMetadata: metadata ?? null,
		})
		rootTraceRef = rootTrace
		const rt = yield* Effect.runtime<never>()
		yield* rootTrace.append("context_built", {
			threadId: threadCtx.threadId,
			sharedPromptContext: prepared.sharedPromptContext,
		})

		const state = {
			execution: undefined as Awaited<ReturnType<typeof executeRequestPlan>> | undefined,
			queryResult: undefined as QueryExecutionResult | undefined,
		}

		const sendMessageTool = onReply
			? tool({
					description:
						"Send a short progress update to the user. In runtimes without incremental messaging this becomes a no-op.",
					inputSchema: z.object({ text: z.string() }),
					execute: async ({ text }) => {
						await onReply(text)
						return { sent: true }
					},
				})
			: tool({
					description:
						"Send a short progress update to the user. In runtimes without incremental messaging this becomes a no-op.",
					inputSchema: z.object({ text: z.string() }),
					execute: async () => ({ sent: false }),
				})

		// Build conversation-level tools
		const searchMemoriesTool = toolGroups["memory-read"]?.search_memories
		const conversationTools: Record<string, unknown> = {
			...(searchMemoriesTool ? { search_memories: searchMemoriesTool } : {}),
			send_message: sendMessageTool,
			execute_plan: tool({
				description:
					"Execute specialist work through the internal execution runtime. Use this when the request needs browser, code, research, integration, memory, settings, computer, or durable execution. Pass the full user request in the 'request' field — do not extract or summarize it.",
				inputSchema: z
					.object({
						request: z.string().describe("The full user request text"),
						context: z.string().optional(),
					})
					.strict(),
				async execute({ request: req, context }) {
					// Block retries only if a previous execution succeeded
					if (state.execution && state.execution.status !== "failed") {
						return {
							mode: state.execution.mode,
							status: state.execution.status,
							tasks: state.execution.taskResults,
							backgroundTasks: state.execution.backgroundTasks,
							summary: "Execution already completed this turn.",
						}
					}
					// Enrich the request with the original user message to ensure
					// the heuristic planner has enough context for routing
					const enrichedRequest =
						inboundText !== req.trim() && inboundText.length > req.length
							? `${inboundText}\n\n${req}`
							: req
					const composed = context?.trim()
						? `${enrichedRequest}\n\nAdditional context:\n${context}`
						: enrichedRequest
					const summary = await executeRequestPlan({
						request: composed,
						query,
						taskStore: config.taskStore,
						config: runConfig,
						getModel: config.getModel,
						toolGroups: toolGroups,
						browser: config.browser,
						supervisor: config.supervisor,
						rootTrace,
					})
					state.execution = summary
					await Runtime.runPromise(rt)(rootTrace.setMode(summary.mode))
					return {
						mode: summary.mode,
						status: summary.status,
						tasks: summary.taskResults,
						backgroundTasks: summary.backgroundTasks,
						summary: summary.summary,
					}
				},
				toModelOutput({ output }) {
					return {
						type: "text" as const,
						value: buildExecutionToolSummary(
							output as {
								mode: AgentRunResult["execution"]["mode"]
								tasks: AgentRunResult["execution"]["tasks"]
								backgroundTasks?: AgentRunResult["execution"]["backgroundTasks"]
							},
						),
					}
				},
			}),
			query_execution: tool({
				description:
					"Inspect durable executions for this conversation. Use this when the user asks about work that is still running or recently completed.",
				inputSchema: z.union([
					z.object({
						kind: z.literal("by-id"),
						taskId: z.string(),
						waitSeconds: z.number().optional(),
					}),
					z.object({
						kind: z.literal("latest"),
						limit: z.number().optional(),
						includeCompleted: z.boolean().optional(),
					}),
				]),
				async execute(input) {
					const result = await Runtime.runPromise(rt)(
						queryExecution({
							query,
							taskStore: config.taskStore,
							supervisor: config.supervisor,
							userId,
							conversationId,
							input,
						}),
					)
					state.queryResult = result
					return result
				},
				toModelOutput({ output }) {
					return {
						type: "text" as const,
						value: buildExecutionToolSummary(output as QueryExecutionResult),
					}
				},
			}),
		}

		const agent = new ToolLoopAgent({
			id: "conversation",
			model: baseModel,
			instructions: prepared.systemPrompt,
			tools: conversationTools as ToolSet,
			stopWhen: stepCountIs(runConfig.budgets.maxConversationSteps),
			prepareStep: buildConversationPrepareStep(),
			experimental_telemetry: createTelemetrySettings({
				functionId:
					mode === "stream-message" ? "amby.conversation.stream" : "amby.conversation.generate",
				request: runConfig.request,
				modelId: config.defaultModelId,
				agentRole: "conversation",
			}),
			experimental_onStepStart: async (event) => {
				await Runtime.runPromise(rt)(
					rootTrace.append("model_request", {
						stepNumber: event.stepNumber,
						activeTools: event.activeTools,
					}),
				)
			},
			onStepFinish: async (event) => {
				await Runtime.runPromise(rt)(
					rootTrace.append("model_response", {
						finishReason: event.finishReason,
						text: event.text,
					}),
				)
			},
		})

		const messages = [
			...prepared.history,
			...requestMessages.map((m) => ({ role: "user" as const, content: m.content })),
		]

		const result = yield* Effect.tryPromise({
			try: async () => {
				if (onPart || onTextDelta) {
					const stream = await agent.stream({ messages })
					for await (const part of stream.fullStream) {
						switch (part.type) {
							case "text-delta":
								onTextDelta?.(part.text)
								onPart?.({ type: "text-delta", text: part.text })
								break
							case "tool-call":
								onPart?.({
									type: "tool-call",
									toolName: part.toolName,
									args: part.input as Record<string, unknown>,
								})
								break
							case "tool-result":
								onPart?.({
									type: "tool-result",
									toolName: part.toolName,
									result: part.output,
								})
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
			catch: (cause) => new AgentError({ message: "Agent request failed", cause }),
		})

		yield* Effect.tryPromise(() => flushConversationToolEvents(result, rootTrace, rt)).pipe(
			Effect.catchAll(() => Effect.void),
		)

		// Persist messages
		const threadMeta = {
			threadId: threadCtx.threadId,
			router: {
				action: threadCtx.decision.action,
				source: threadCtx.decision.source,
			},
		}
		const userMetadata = metadata ? { ...metadata, ...threadMeta } : threadMeta
		for (const m of requestMessages) {
			yield* query((database) =>
				database
					.insert(config.schema.messages)
					.values({
						conversationId,
						role: "user",
						content: m.content,
						threadId: threadCtx.threadId,
						metadata: userMetadata,
					})
					.returning({ id: config.schema.messages.id }),
			)
		}

		const savedRows = result.text.trim()
			? yield* query((database) =>
					database
						.insert(config.schema.messages)
						.values({
							conversationId,
							role: "assistant",
							content: result.text,
							threadId: threadCtx.threadId,
						})
						.returning({ id: config.schema.messages.id }),
				)
			: ([] as Array<{ id: string }>)

		yield* rootTrace.linkMessage(savedRows[0]?.id)
		yield* config.synopsisCurrentThreadIfOverflowsAfterSave(
			query,
			baseModel,
			conversationId,
			threadCtx,
			requestMessages.length + 1,
		)

		const execution = state.execution
			? {
					mode: state.execution.mode,
					rootTraceId: rootTrace.runId,
					tasks: state.execution.taskResults,
					backgroundTasks: state.execution.backgroundTasks,
				}
			: {
					mode: "direct" as const,
					rootTraceId: rootTrace.runId,
					tasks: [],
					backgroundTasks: state.queryResult?.executions.map((e) => ({
						taskId: e.taskId,
						traceId: e.traceId ?? "",
						status: e.status,
					})),
				}

		const agentResult: AgentRunResult = {
			status: state.execution?.status ?? "completed",
			userResponse: { text: result.text },
			execution,
			sideEffects: {
				memoriesSaved: state.execution?.sideEffects.memoriesSaved,
				scheduledJobs: state.execution?.sideEffects.scheduledJobs,
				externalWrites: state.execution?.sideEffects.externalWrites,
			},
		}

		yield* rootTrace.complete(agentResult.status === "failed" ? "failed" : "completed", {
			executionMode: agentResult.execution.mode,
			status: agentResult.status,
		})

		return agentResult
	}).pipe(
		Effect.catchAll((error) =>
			Effect.gen(function* () {
				const trace = rootTraceRef
				if (trace) {
					yield* trace
						.complete("failed", { error: toErrorMessage(error) })
						.pipe(Effect.catchAll(() => Effect.void))
				}
				if (error instanceof AgentError) return yield* error
				return yield* new AgentError({ message: "Agent request failed", cause: error })
			}),
		),
	)
}

function buildRunConfig(params: {
	userId: string
	conversationId: string
	threadId: string
	mode: "message" | "batched-message" | "stream-message"
	environment: string
	requestMetadata?: Record<string, unknown>
	modelId: string
	highReasoningModelId: string
	routerModelId?: string
	userTimezone: string
	sharedPromptContext: string
	runtime: {
		sandboxEnabled: boolean
		cuaEnabled: boolean
		integrationEnabled: boolean
		streamingEnabled: boolean
		browserEnabled: boolean
	}
}): AgentRunConfig {
	return {
		request: {
			requestId: crypto.randomUUID(),
			conversationId: params.conversationId,
			threadId: params.threadId,
			userId: params.userId,
			mode: params.mode,
			environment: normalizeTraceEnvironment(params.environment),
			metadata: params.requestMetadata,
		},
		modelPolicy: {
			defaultModelId: params.modelId,
			lowLatencyModelId: params.modelId,
			highReasoningModelId: params.highReasoningModelId,
			routerModelId: params.routerModelId,
			validatorModelId: params.highReasoningModelId,
		},
		runtime: params.runtime,
		policy: {
			allowDirectAnswer: true,
			allowBackgroundTasks: params.runtime.sandboxEnabled,
			allowMemoryWrites: true,
			allowExternalWrites: true,
			requireWriteConfirmation: true,
			maxDepth: 1,
		},
		budgets: {
			maxConversationSteps: CONVERSATION_MAX_STEPS,
			maxSubagentStepsByKind: {},
			maxParallelAgents: 3,
			maxToolCallsPerRun: 32,
		},
		context: {
			sharedPromptContext: params.sharedPromptContext,
			userTimezone: params.userTimezone,
		},
		trace: {
			enabled: true,
			includeToolPayloads: true,
			includeContextEvents: true,
		},
	}
}

export { buildExecutionToolSummary, buildRunConfig }
