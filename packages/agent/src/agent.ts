import { BrowserService } from "@amby/browser"
import type { Platform } from "@amby/channels"
import { createComputerTools, createCuaTools, SandboxService, TaskSupervisor } from "@amby/computer"
import { ConnectorsService, createConnectorManagementTools } from "@amby/connectors"
import { DbService, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { createMemoryTools, MemoryService } from "@amby/memory"
import { stepCountIs, ToolLoopAgent, type ToolSet, tool } from "ai"
import { Context, Effect, Layer } from "effect"
import { z } from "zod"
import { prepareConversationContext } from "./context/builder"
import { AgentError } from "./errors"
import { executeRequestPlan } from "./execution/coordinator"
import { createRootTrace, type TraceWriter } from "./execution/ledger"
import { queryExecution } from "./execution/query-execution"
import type { ToolGroups } from "./execution/registry"
import { HIGH_INTELLIGENCE_MODEL_ID, ModelService } from "./models"
import { type ResolveThreadResult, resolveThread } from "./router"
import {
	synopsisCurrentThreadIfOverflowsAfterSave,
	synopsisPreviousThreadIfDormantSwitch,
} from "./synopsis"
import {
	type AgentTraceMetadata,
	createTelemetrySettings,
	initializeTelemetry,
	shutdownTelemetry,
	withTelemetryFlush,
} from "./telemetry"
import { createCodexAuthTools } from "./tools/codex-auth"
import { createJobTools, createReplyTools, type ReplyFn } from "./tools/messaging"
import type { AgentRunConfig, AgentRunResult, StreamPart } from "./types/agent"
import type { QueryExecutionResult } from "./types/execution"

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

function buildThreadMeta(threadCtx: ResolveThreadResult) {
	return {
		threadId: threadCtx.threadId,
		router: {
			action: threadCtx.decision.action,
			source: threadCtx.decision.source,
		},
	}
}

function buildRunConfig(params: {
	userId: string
	conversationId: string
	threadId: string
	mode: "message" | "batched-message" | "stream-message"
	modelId: string
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
		},
		modelPolicy: {
			defaultModelId: params.modelId,
			lowLatencyModelId: params.modelId,
			highReasoningModelId: HIGH_INTELLIGENCE_MODEL_ID,
			validatorModelId: HIGH_INTELLIGENCE_MODEL_ID,
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

function buildSendMessageTool(onReply?: ReplyFn) {
	if (onReply) {
		return createReplyTools(onReply).send_message
	}

	return tool({
		description:
			"Send a short progress update to the user. In runtimes without incremental messaging this becomes a no-op.",
		inputSchema: z.object({ text: z.string() }),
		execute: async () => ({ sent: false }),
	})
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
				}${
					preview ? `\nOutput preview: ${preview}` : ""
				}${progress?.length ? `\nRecent progress: ${progress.join(" | ")}` : ""}${artifacts}`
			})
			.join("\n")
	}

	if (result.tasks.length === 0) {
		return "No specialist execution was required."
	}

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
			return {
				activeTools: [],
			}
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
		await Effect.runPromise(trace.appendMany(events))
	}
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
		) => Effect.Effect<AgentRunResult, AgentError>
		readonly handleBatchedMessages: (
			conversationId: string,
			messages: string[],
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
			onTextDelta?: (text: string) => void,
		) => Effect.Effect<AgentRunResult, AgentError>
		readonly streamMessage: (
			conversationId: string,
			content: string,
			onPart: (part: StreamPart) => void,
		) => Effect.Effect<AgentRunResult, AgentError>
		readonly ensureConversation: (
			platform: Platform,
			externalConversationKey: string,
			workspaceKey?: string,
		) => Effect.Effect<string, AgentError>
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
			const browserService = yield* BrowserService
			const taskSupervisor = yield* TaskSupervisor
			const connectors = yield* ConnectorsService
			const env = yield* EnvService
			initializeTelemetry({
				apiKey: env.BRAINTRUST_API_KEY,
				projectId: env.BRAINTRUST_PROJECT_ID,
			})
			const baseModel = models.getModel()

			const computer = createComputerTools(sandbox, userId)

			const saveMessage = (
				conversationId: string,
				role: "user" | "assistant",
				content: string,
				opts?: {
					metadata?: Record<string, unknown>
					threadId?: string
				},
			) =>
				query((database) =>
					database
						.insert(schema.messages)
						.values({
							conversationId,
							role,
							content,
							threadId: opts?.threadId,
							metadata: opts?.metadata,
						})
						.returning({ id: schema.messages.id }),
				)

			const maybeSaveAssistantMessage = (
				conversationId: string,
				content: string,
				opts?: {
					threadId?: string
				},
			) =>
				content.trim()
					? saveMessage(conversationId, "assistant", content, opts)
					: Effect.succeed([] as Array<{ id: string }>)

			const runRequest = ({
				conversationId,
				mode,
				requestMessages,
				metadata,
				onReply,
				onTextDelta,
				onPart,
			}: {
				conversationId: string
				mode: AgentRunConfig["request"]["mode"]
				requestMessages: ReadonlyArray<{ role: "user"; content: string }>
				metadata?: Record<string, unknown>
				onReply?: ReplyFn
				onTextDelta?: (text: string) => void
				onPart?: (part: StreamPart) => void
			}) => {
				let rootTraceRef: TraceWriter | undefined
				return Effect.gen(function* () {
					const inboundText = requestMessages.map((message) => message.content).join("\n\n")
					const threadCtx = yield* resolveThread(query, conversationId, inboundText, baseModel)

					yield* synopsisPreviousThreadIfDormantSwitch(query, baseModel, conversationId, threadCtx)

					const prepared = yield* prepareConversationContext({
						query,
						userId,
						conversationId,
						threadCtx,
						memory,
					})

					const config = buildRunConfig({
						userId,
						conversationId,
						threadId: threadCtx.threadId,
						mode,
						modelId: models.defaultModelId,
						userTimezone: prepared.userTimezone,
						sharedPromptContext: prepared.sharedPromptContext,
						runtime: {
							sandboxEnabled: sandbox.enabled,
							cuaEnabled: env.ENABLE_CUA && sandbox.enabled,
							integrationEnabled: connectors.isEnabled(),
							streamingEnabled: Boolean(onPart || onTextDelta),
							browserEnabled: browserService.enabled,
						},
					})

					const rootTrace = yield* createRootTrace(query, config, {
						router: threadCtx.decision,
						requestMetadata: metadata ?? null,
					})
					rootTraceRef = rootTrace
					yield* rootTrace.append("context_built", {
						threadId: threadCtx.threadId,
						sharedPromptContext: prepared.sharedPromptContext,
					})

					const memoryTools = createMemoryTools(memory, userId)
					const settingsTools = {
						...createJobTools(db, userId, prepared.userTimezone),
						...(sandbox.enabled ? createCodexAuthTools(taskSupervisor, userId) : {}),
					}
					const integrationTools = connectors.isEnabled()
						? ({
								...(createConnectorManagementTools(connectors, userId) ?? {}),
								...((yield* connectors
									.getAgentTools(userId)
									.pipe(Effect.catchAll(() => Effect.succeed(undefined)))) ?? {}),
							} as ToolSet)
						: undefined
					const cuaTools = config.runtime.cuaEnabled
						? createCuaTools(sandbox, userId, conversationId, computer.getSandbox).tools
						: undefined

					const toolGroups: ToolGroups = {
						"memory-read": { search_memories: memoryTools.search_memories },
						"memory-write": { save_memory: memoryTools.save_memory },
						"sandbox-read": computer.readTools,
						"sandbox-write": computer.writeTools,
						settings: settingsTools as ToolSet,
						cua: cuaTools as ToolSet | undefined,
						integration: integrationTools,
					}

					const state = {
						execution: undefined as Awaited<ReturnType<typeof executeRequestPlan>> | undefined,
						queryResult: undefined as QueryExecutionResult | undefined,
					}

					const conversationTools = {
						search_memories: memoryTools.search_memories,
						send_message: buildSendMessageTool(onReply),
						execute_plan: tool({
							description:
								"Execute specialist work through the internal execution runtime. Use this when the request needs browser, code, research, integration, memory, settings, computer, or durable execution.",
							inputSchema: z
								.object({
									request: z.string(),
									context: z.string().optional(),
								})
								.strict(),
							async execute({ request, context }) {
								if (state.execution) {
									return {
										mode: state.execution.mode,
										status: state.execution.status,
										tasks: state.execution.taskResults,
										backgroundTasks: state.execution.backgroundTasks,
										summary: "Execution already completed this turn.",
									}
								}
								const composed = context?.trim()
									? `${request}\n\nAdditional context:\n${context}`
									: request
								const summary = await executeRequestPlan({
									request: composed,
									query,
									config,
									getModel: models.getModel,
									toolGroups,
									browser: browserService,
									supervisor: taskSupervisor,
									rootTrace,
								})
								state.execution = summary
								await Effect.runPromise(rootTrace.setMode(summary.mode))
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
								const result = await Effect.runPromise(
									queryExecution({
										query,
										supervisor: taskSupervisor,
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
						tools: conversationTools,
						stopWhen: stepCountIs(config.budgets.maxConversationSteps),
						prepareStep: buildConversationPrepareStep(),
						experimental_telemetry: createTelemetrySettings({
							functionId:
								config.request.mode === "stream-message"
									? "amby.conversation.stream"
									: "amby.conversation.generate",
							metadata: {
								request_id: config.request.requestId,
								conversation_id: config.request.conversationId,
								request_mode: config.request.mode,
								user_id: userId,
								model_id: models.defaultModelId,
								agent_role: "conversation",
							} as AgentTraceMetadata,
						}),
						experimental_onStepStart: async (event) => {
							await Effect.runPromise(
								rootTrace.append("model_request", {
									stepNumber: event.stepNumber,
									activeTools: event.activeTools,
								}),
							)
						},
						onStepFinish: async (event) => {
							await Effect.runPromise(
								rootTrace.append("model_response", {
									finishReason: event.finishReason,
									text: event.text,
								}),
							)
						},
					})

					const messages = [
						...prepared.history,
						...requestMessages.map((message) => ({
							role: "user" as const,
							content: message.content,
						})),
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

					yield* Effect.tryPromise(() => flushConversationToolEvents(result, rootTrace)).pipe(
						Effect.catchAll(() => Effect.void),
					)

					const threadMeta = buildThreadMeta(threadCtx)
					const userMetadata = metadata ? { ...metadata, ...threadMeta } : threadMeta
					for (const message of requestMessages) {
						yield* saveMessage(conversationId, "user", message.content, {
							metadata: userMetadata,
							threadId: threadCtx.threadId,
						})
					}

					const savedRows = yield* maybeSaveAssistantMessage(conversationId, result.text, {
						threadId: threadCtx.threadId,
					})
					yield* rootTrace.linkMessage(savedRows[0]?.id)
					yield* synopsisCurrentThreadIfOverflowsAfterSave(
						query,
						baseModel,
						conversationId,
						threadCtx,
						requestMessages.length + 1,
					)

					const execution = state.execution
						? {
								mode: state.execution.mode,
								rootTraceId: rootTrace.traceId,
								tasks: state.execution.taskResults,
								backgroundTasks: state.execution.backgroundTasks,
							}
						: {
								mode: "direct" as const,
								rootTraceId: rootTrace.traceId,
								tasks: [],
								backgroundTasks: state.queryResult?.executions.map((execution) => ({
									taskId: execution.taskId,
									traceId: execution.traceId ?? "",
									status: execution.status,
								})),
							}

					const agentResult: AgentRunResult = {
						status: state.execution?.status ?? "completed",
						userResponse: {
							text: result.text,
						},
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
							if (error instanceof AgentError) return yield* Effect.fail(error)
							return yield* Effect.fail(
								new AgentError({
									message: "Agent request failed",
									cause: error,
								}),
							)
						}),
					),
				)
			}

			return {
				handleMessage: (conversationId, content, metadata, onReply, onTextDelta) =>
					withTelemetryFlush(
						runRequest({
							conversationId,
							mode: "message",
							requestMessages: [{ role: "user", content }],
							metadata,
							onReply,
							onTextDelta,
						}),
					),

				handleBatchedMessages: (conversationId, messages, metadata, onReply, onTextDelta) =>
					withTelemetryFlush(
						runRequest({
							conversationId,
							mode: "batched-message",
							requestMessages: messages.map((content) => ({ role: "user" as const, content })),
							metadata,
							onReply,
							onTextDelta,
						}),
					),

				streamMessage: (conversationId, content, onPart) =>
					withTelemetryFlush(
						runRequest({
							conversationId,
							mode: "stream-message",
							requestMessages: [{ role: "user", content }],
							onPart,
						}),
					),

				ensureConversation: (platform, externalConversationKey, workspaceKey) =>
					query((database) =>
						database
							.insert(schema.conversations)
							.values({
								userId,
								platform,
								externalConversationKey,
								workspaceKey: workspaceKey ?? "",
							})
							.onConflictDoUpdate({
								target: [
									schema.conversations.userId,
									schema.conversations.platform,
									schema.conversations.workspaceKey,
									schema.conversations.externalConversationKey,
								],
								set: { updatedAt: new Date() },
							})
							.returning({ id: schema.conversations.id }),
					).pipe(
						Effect.map((rows) => {
							const row = rows[0]
							if (!row) throw new Error("Failed to ensure conversation")
							return row.id
						}),
						Effect.mapError(
							(cause) =>
								new AgentError({
									message: cause instanceof Error ? cause.message : "Failed to ensure conversation",
									cause,
								}),
						),
					),

				shutdown: () =>
					Effect.gen(function* () {
						const instance = computer.getSandbox()
						if (instance) {
							yield* sandbox.stop(instance).pipe(Effect.catchAll(() => Effect.void))
						}
						yield* taskSupervisor.shutdown()
						yield* Effect.tryPromise(() => shutdownTelemetry()).pipe(
							Effect.catchAll(() => Effect.void),
						)
					}).pipe(
						Effect.mapError(
							(cause) => new AgentError({ message: "Failed to shut down agent", cause }),
						),
					),
			}
		}),
	)
