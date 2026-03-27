import type { BrowserService } from "@amby/browser"
import type { TaskSupervisor } from "@amby/computer"
import type { TaskStoreService } from "@amby/core"
import type { LanguageModel } from "ai"
import { Effect } from "effect"
import { buildTaskTraceMetadata } from "../trace-metadata"
import type { AgentRunConfig } from "../types/agent"
import type {
	ExecutionPlan,
	ExecutionSummary,
	ExecutionTask,
	ExecutionTaskResult,
} from "../types/execution"
import type { ExecutionRequestEnvelope, ExecutionResponseEnvelope } from "../types/persistence"
import { createTrace, type QueryFn, type TraceWriter } from "./ledger"
import { buildReadyBatch } from "./locks"
import { buildExecutionPlan } from "./planner"
import { buildExecutionSummary } from "./reducer"
import type { ToolGroups } from "./registry"
import { runBackgroundSpecialist } from "./runners/background"
import { runBrowserSpecialist } from "./runners/browser"
import { runToolloopSpecialist } from "./runners/toolloop"
import { persistTaskCompleted, persistTaskCreated } from "./task-persistence"

function findBlockingDependency(
	task: ExecutionTask,
	completed: Map<string, ExecutionTaskResult>,
): ExecutionTaskResult | undefined {
	return task.dependencies
		.map((dependencyId) => completed.get(dependencyId))
		.find(
			(result): result is ExecutionTaskResult =>
				result !== undefined && (result.status === "failed" || result.status === "escalate"),
		)
}

function buildBlockedDependencyResult(
	task: ExecutionTask,
	blockingDependency: ExecutionTaskResult,
	rootTraceId: string,
): ExecutionTaskResult {
	const message = `Blocked by dependency ${blockingDependency.taskId}: ${blockingDependency.summary}`
	return {
		taskId: task.id,
		rootTaskId: task.rootTaskId,
		parentTaskId: task.parentTaskId,
		depth: task.depth,
		specialist: task.specialist,
		status: "failed",
		summary: message,
		issues: [
			{
				code: "blocked_dependency",
				message,
				metadata: {
					dependencyTaskId: blockingDependency.taskId,
					dependencyStatus: blockingDependency.status,
				},
			},
		],
		traceRef: { traceId: rootTraceId },
	}
}

export function materializePlan(plan: ExecutionPlan): ExecutionTask[] {
	const ids = plan.tasks.map(() => crypto.randomUUID())
	return plan.tasks.map((task, index) => {
		const id = ids[index] ?? crypto.randomUUID()
		const dependencyIds = task.dependencies.map((dependency) => {
			const match = /^task-(\d+)$/.exec(dependency)
			if (!match) return dependency
			const sourceIndex = Number.parseInt(match[1] ?? "", 10)
			return ids[sourceIndex] ?? dependency
		})
		return {
			...task,
			id,
			rootTaskId: ids[0] ?? id,
			depth: 1,
			dependencies: dependencyIds,
		}
	})
}

function buildRequestEnvelope(task: ExecutionTask): ExecutionRequestEnvelope {
	return {
		taskId: task.id,
		rootTaskId: task.rootTaskId,
		parentTaskId: task.parentTaskId,
		depth: task.depth,
		specialist: task.specialist,
		runnerKind: task.runnerKind,
		dependencies: task.dependencies,
		input: task.input as unknown as ExecutionRequestEnvelope["input"],
		resourceLocks: task.resourceLocks,
		mutates: task.mutates,
		writesExternal: task.writesExternal,
		requiresConfirmation: task.requiresConfirmation,
		requiresValidation: task.requiresValidation,
	}
}

function buildResponseEnvelope(result: ExecutionTaskResult): ExecutionResponseEnvelope {
	return {
		taskId: result.taskId,
		status: result.status,
		summary: result.summary,
		data: result.data,
		artifacts: result.artifacts,
		issues: result.issues,
		metrics: result.metrics as Record<string, unknown> | undefined,
		backgroundRef: result.backgroundRef,
	}
}

async function runTaskWithTrace(params: {
	task: ExecutionTask
	query: QueryFn
	taskStore: TaskStoreService
	config: AgentRunConfig
	getModel: (id?: string) => LanguageModel
	toolGroups: ToolGroups
	browser: import("effect").Context.Tag.Service<typeof BrowserService>
	supervisor: import("effect").Context.Tag.Service<typeof TaskSupervisor>
	rootTrace: TraceWriter
}) {
	const requestEnvelope = buildRequestEnvelope(params.task)
	let progressSeq = 0
	const trace = await Effect.runPromise(
		createTrace({
			query: params.query,
			conversationId: params.config.request.conversationId,
			threadId: params.config.request.threadId,
			parentTraceId: params.rootTrace.traceId,
			rootTraceId: params.rootTrace.traceId,
			taskId: params.task.id,
			specialist: params.task.specialist,
			runnerKind: params.task.runnerKind,
			mode: params.task.mode,
			depth: params.task.depth,
			metadata: buildTaskTraceMetadata({
				request: params.config.request,
				executionRequest: requestEnvelope,
			}),
		}),
	)

	await Effect.runPromise(
		trace.append("delegation_start", {
			taskId: params.task.id,
			specialist: params.task.specialist,
			runnerKind: params.task.runnerKind,
			request: requestEnvelope,
		}),
	)

	if (params.task.runnerKind !== "background_handoff") {
		await persistTaskCreated(params.taskStore, params.task, {
			userId: params.config.request.userId,
			conversationId: params.config.request.conversationId,
			threadId: params.config.request.threadId,
			traceId: trace.traceId,
		})
	}

	try {
		const runResult =
			params.task.runnerKind === "browser_service"
				? await runBrowserSpecialist({
						task: params.task,
						browser: params.browser,
						trace,
						onProgress: async (event) => {
							progressSeq += 1
							try {
								await Effect.runPromise(
									params.taskStore.appendProgressEvent({
										taskId: params.task.id,
										seq: progressSeq,
										kind: "task.progress",
										status: "running",
										payload: {
											phase: event.phase ?? null,
											category: event.category ?? null,
											message: event.message,
											level: event.level ?? null,
											stepIndex: event.stepIndex ?? null,
											page: event.page ?? null,
											auxiliary: event.auxiliary,
										},
									}),
								)
							} catch (error) {
								console.warn(
									`[execution-coordinator] Failed to persist browser progress for task ${params.task.id}:`,
									error instanceof Error ? error.message : String(error),
								)
							}
						},
					})
				: params.task.runnerKind === "background_handoff"
					? await runBackgroundSpecialist({
							task: params.task,
							supervisor: params.supervisor,
							userId: params.config.request.userId,
							conversationId: params.config.request.conversationId,
							threadId: params.config.request.threadId,
							trace,
						})
					: await runToolloopSpecialist({
							task: params.task,
							config: params.config,
							getModel: params.getModel,
							toolGroups: params.toolGroups,
							trace,
						})

		if (runResult.toolEvents.length > 0) {
			await Effect.runPromise(trace.appendMany(runResult.toolEvents))
		}

		if (params.task.runnerKind === "background_handoff") {
			await Effect.runPromise(
				trace.updateMetadata(
					buildTaskTraceMetadata({
						request: params.config.request,
						executionRequest: requestEnvelope,
						executionResponse: buildResponseEnvelope(runResult.result),
					}),
				),
			)
			await Effect.runPromise(trace.complete("completed"))
			return runResult.result
		}

		const responseEnvelope = buildResponseEnvelope(runResult.result)
		await Effect.runPromise(
			trace.append("delegation_end", {
				taskId: params.task.id,
				response: responseEnvelope,
			}),
		)
		await Effect.runPromise(
			trace.complete(
				runResult.result.status === "failed" ? "failed" : "completed",
				buildTaskTraceMetadata({
					request: params.config.request,
					executionRequest: requestEnvelope,
					executionResponse: responseEnvelope,
				}),
			),
		)
		await persistTaskCompleted(params.taskStore, params.task.id, runResult.result)
		return runResult.result
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		const failedResult: ExecutionTaskResult = {
			taskId: params.task.id,
			rootTaskId: params.task.rootTaskId,
			parentTaskId: params.task.parentTaskId,
			depth: params.task.depth,
			specialist: params.task.specialist,
			status: "failed",
			summary: message,
			issues: [{ code: "execution_failed", message }],
			traceRef: { traceId: trace.traceId },
		}
		await Effect.runPromise(
			trace.append("error", {
				taskId: params.task.id,
				message,
			}),
		)
		await Effect.runPromise(
			trace.complete(
				"failed",
				buildTaskTraceMetadata({
					request: params.config.request,
					executionRequest: requestEnvelope,
					executionResponse: buildResponseEnvelope(failedResult),
				}),
			),
		)
		if (params.task.runnerKind !== "background_handoff") {
			await persistTaskCompleted(params.taskStore, params.task.id, failedResult)
		}
		return failedResult
	}
}

async function runValidatorIfNeeded(params: {
	query: QueryFn
	taskStore: TaskStoreService
	config: AgentRunConfig
	getModel: (id?: string) => LanguageModel
	toolGroups: ToolGroups
	browser: import("effect").Context.Tag.Service<typeof BrowserService>
	supervisor: import("effect").Context.Tag.Service<typeof TaskSupervisor>
	rootTrace: TraceWriter
	plan: ExecutionPlan
	taskResults: ExecutionTaskResult[]
}): Promise<ExecutionTaskResult | undefined> {
	if (
		params.plan.reducer !== "validator" &&
		!params.taskResults.some((task) => task.status === "partial" || task.status === "escalate") &&
		!params.taskResults.some((task) => task.issues && task.issues.length > 0)
	) {
		return undefined
	}

	const validatorTask: ExecutionTask = {
		id: crypto.randomUUID(),
		rootTaskId: "",
		depth: 1,
		specialist: "validator",
		runnerKind: "toolloop",
		mode: "sequential",
		input: {
			kind: "specialist",
			goal: "Validate the completed execution tasks and identify conflicts, risks, or missing verification.",
			payload: {
				plan: params.plan,
				taskResults: params.taskResults,
			},
		},
		dependencies: params.taskResults.map((task) => task.taskId),
		inputBindings: Object.fromEntries(
			params.taskResults.map((task) => [task.taskId, task.data ?? { summary: task.summary }]),
		),
		resourceLocks: [],
		mutates: false,
		writesExternal: false,
		requiresConfirmation: false,
		requiresValidation: false,
	}
	validatorTask.rootTaskId = validatorTask.id

	return runTaskWithTrace({
		task: validatorTask,
		query: params.query,
		taskStore: params.taskStore,
		config: params.config,
		getModel: params.getModel,
		toolGroups: params.toolGroups,
		browser: params.browser,
		supervisor: params.supervisor,
		rootTrace: params.rootTrace,
	})
}

export async function executeRequestPlan(params: {
	request: string
	query: QueryFn
	taskStore: TaskStoreService
	config: AgentRunConfig
	getModel: (id?: string) => LanguageModel
	toolGroups: ToolGroups
	browser: import("effect").Context.Tag.Service<typeof BrowserService>
	supervisor: import("effect").Context.Tag.Service<typeof TaskSupervisor>
	rootTrace: TraceWriter
}): Promise<ExecutionSummary> {
	const plan = await buildExecutionPlan({
		request: params.request,
		config: params.config,
		getModel: params.getModel,
	})

	if (plan.strategy === "direct" || plan.tasks.length === 0) {
		return buildExecutionSummary({
			mode: "direct",
			taskResults: [],
		})
	}

	const pending = materializePlan(plan)
	const completed = new Map<string, ExecutionTaskResult>()

	while (pending.length > 0) {
		let blockedDependencyFound = false
		for (const task of [...pending]) {
			const blockingDependency = findBlockingDependency(task, completed)
			if (!blockingDependency) continue

			completed.set(
				task.id,
				buildBlockedDependencyResult(task, blockingDependency, params.rootTrace.traceId),
			)
			const index = pending.findIndex((candidate) => candidate.id === task.id)
			if (index >= 0) pending.splice(index, 1)
			blockedDependencyFound = true
		}

		if (blockedDependencyFound) {
			continue
		}

		const batch = buildReadyBatch(
			pending,
			completed,
			[],
			plan.strategy === "parallel" ? params.config.budgets.maxParallelAgents : 1,
		)

		if (batch.length === 0) {
			throw new Error("Execution plan is blocked by unresolved dependencies or conflicting locks.")
		}

		const runnable = batch.map((task) => ({
			...task,
			rootTaskId: task.rootTaskId,
			inputBindings: Object.fromEntries(
				task.dependencies
					.map((dependencyId) => completed.get(dependencyId))
					.filter((result): result is ExecutionTaskResult => Boolean(result))
					.map((result) => [result.taskId, result.data ?? { summary: result.summary }]),
			),
		}))

		const firstRunnable = runnable[0]
		if (!firstRunnable) {
			throw new Error("Execution plan is blocked by unresolved dependencies or conflicting locks.")
		}

		const results =
			plan.strategy === "parallel"
				? await Promise.all(
						runnable.map((task) =>
							runTaskWithTrace({
								task,
								query: params.query,
								taskStore: params.taskStore,
								config: params.config,
								getModel: params.getModel,
								toolGroups: params.toolGroups,
								browser: params.browser,
								supervisor: params.supervisor,
								rootTrace: params.rootTrace,
							}),
						),
					)
				: [
						await runTaskWithTrace({
							task: firstRunnable,
							query: params.query,
							taskStore: params.taskStore,
							config: params.config,
							getModel: params.getModel,
							toolGroups: params.toolGroups,
							browser: params.browser,
							supervisor: params.supervisor,
							rootTrace: params.rootTrace,
						}),
					]

		for (const result of results) {
			completed.set(result.taskId, result)
			const index = pending.findIndex((task) => task.id === result.taskId)
			if (index >= 0) pending.splice(index, 1)
		}
	}

	const taskResults = [...completed.values()]
	const validatorResult = await runValidatorIfNeeded({
		query: params.query,
		taskStore: params.taskStore,
		config: params.config,
		getModel: params.getModel,
		toolGroups: params.toolGroups,
		browser: params.browser,
		supervisor: params.supervisor,
		rootTrace: params.rootTrace,
		plan,
		taskResults,
	})

	return buildExecutionSummary({
		mode: plan.strategy,
		taskResults,
		validatorResult,
	})
}
