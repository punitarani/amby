import type { TaskSupervisor } from "@amby/computer"
import { Effect } from "effect"
import type { TraceWriter } from "../ledger"
import type { ExecutionTask, ExecutionTaskResult } from "../../types/execution"

export async function runBackgroundSpecialist(params: {
	task: ExecutionTask
	supervisor: import("effect").Context.Tag.Service<typeof TaskSupervisor>
	userId: string
	conversationId: string
	threadId?: string
	trace: TraceWriter
}) {
	if (params.task.input.kind !== "background") {
		throw new Error("Background runner received a non-background task input.")
	}

	const started = await Effect.runPromise(
		params.supervisor.startTask({
			taskId: params.task.id,
			userId: params.userId,
			prompt: params.task.input.prompt,
			needsBrowser: params.task.input.needsBrowser,
			conversationId: params.conversationId,
			threadId: params.threadId,
			traceId: params.trace.traceId,
			parentTaskId: params.task.parentTaskId,
			rootTaskId: params.task.rootTaskId,
			specialist: params.task.specialist,
			runnerKind: params.task.runnerKind,
			input: {
				task: params.task.input,
				inputBindings: params.task.inputBindings,
				resourceLocks: params.task.resourceLocks,
			},
			metadata: {
				depth: params.task.depth,
				spawnedBySpecialist: params.task.spawnedBySpecialist ?? null,
				requiresConfirmation: params.task.requiresConfirmation,
				requiresValidation: params.task.requiresValidation,
			},
			confirmationState: params.task.requiresConfirmation ? "required" : "not_required",
		}),
	)

	const result: ExecutionTaskResult = {
		taskId: params.task.id,
		rootTaskId: params.task.rootTaskId,
		parentTaskId: params.task.parentTaskId,
		depth: params.task.depth,
		specialist: params.task.specialist,
		status: "completed",
		summary: "Background task started.",
		traceRef: { traceId: params.trace.traceId },
		backgroundRef: {
			taskId: started.taskId,
			traceId: params.trace.traceId,
		},
		data: {
			status: started.status,
		},
	}

	return {
		result,
		toolEvents: [
			{
				kind: "tool_result" as const,
				payload: {
					toolName: "background_handoff",
					output: {
						taskId: started.taskId,
						status: started.status,
					},
				},
			},
		],
	}
}
