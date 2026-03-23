import type { TaskStatus } from "@amby/db"
import type { AgentRunResult } from "../types/agent"
import type { ExecutionSummary, ExecutionTaskResult } from "../types/execution"

function summarizeTask(task: ExecutionTaskResult): string {
	return `${task.specialist}: ${task.summary}`
}

function collectBackgroundTasks(tasks: ExecutionTaskResult[]): Array<{
	taskId: string
	traceId: string
	status: TaskStatus
}> {
	return tasks
		.flatMap((task) =>
			task.backgroundRef
				? [{ taskId: task.backgroundRef.taskId, traceId: task.backgroundRef.traceId, status: "running" as const }]
				: [],
		)
}

export function buildExecutionSummary(params: {
	mode: AgentRunResult["execution"]["mode"]
	taskResults: ExecutionTaskResult[]
	validatorResult?: ExecutionTaskResult
}): ExecutionSummary {
	const allTasks = params.validatorResult
		? [...params.taskResults, params.validatorResult]
		: params.taskResults

	const hasFailure = allTasks.some((task) => task.status === "failed")
	const hasPartial = allTasks.some((task) => task.status === "partial" || task.status === "escalate")
	const status = hasFailure ? "failed" : hasPartial ? "partial" : "completed"

	const sideEffects = {
		memoriesSaved: allTasks
			.filter((task) => task.specialist === "memory" && task.data && typeof task.data === "object")
			.flatMap((task) => {
				const ids = (task.data as Record<string, unknown>).memoryIds
				return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
			}),
		scheduledJobs: allTasks
			.filter((task) => task.specialist === "settings" && task.data && typeof task.data === "object")
			.flatMap((task) => {
				const ids = (task.data as Record<string, unknown>).scheduledJobIds
				return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
			}),
		externalWrites: allTasks
			.filter((task) => task.specialist === "integration")
			.map((task) => task.summary),
	}

	return {
		mode: params.mode,
		status,
		summary: allTasks.length > 0 ? allTasks.map(summarizeTask).join(" | ") : "Answered directly.",
		taskResults: allTasks,
		backgroundTasks: collectBackgroundTasks(allTasks),
		sideEffects,
	}
}
