import {
	completeTaskRecord,
	createTaskRecord,
	deriveRuntimeForRunner,
	type TaskQueryFn,
} from "@amby/computer"
import { Effect } from "effect"
import type { ExecutionTask, ExecutionTaskInput, ExecutionTaskResult } from "../types/execution"

function derivePrompt(input: ExecutionTaskInput): string {
	switch (input.kind) {
		case "specialist":
			return input.goal
		case "browser":
			return input.task.instruction
		case "settings":
			return JSON.stringify(input.task)
		case "background":
			return input.prompt
	}
}

function buildRuntimeData(task: ExecutionTask): Record<string, unknown> | null {
	switch (task.input.kind) {
		case "browser":
			return {
				mode: task.input.task.mode,
				startUrl: task.input.task.startUrl ?? null,
				sideEffectLevel: task.input.task.sideEffectLevel,
			}
		case "specialist":
			return null
		case "settings":
			return {
				settingsTask: task.input.task,
			}
		case "background":
			return {
				instructions: task.input.instructions ?? null,
				context: task.input.context ?? null,
			}
	}
}

export async function persistTaskCreated(
	query: TaskQueryFn,
	task: ExecutionTask,
	config: {
		userId: string
		conversationId: string
		threadId?: string
		traceId: string
	},
): Promise<void> {
	const runtime = deriveRuntimeForRunner({
		runnerKind: task.runnerKind,
		requiresBrowser: task.input.kind === "background" ? task.input.needsBrowser : undefined,
	})

	try {
		await Effect.runPromise(
			createTaskRecord(query, {
				id: task.id,
				userId: config.userId,
				runtime: runtime.runtime,
				provider: runtime.provider,
				status: "running",
				specialist: task.specialist,
				runnerKind: task.runnerKind,
				conversationId: config.conversationId,
				threadId: config.threadId,
				traceId: config.traceId,
				rootTaskId: task.rootTaskId,
				parentTaskId: task.parentTaskId,
				input: task.input,
				prompt: derivePrompt(task.input),
				requiresBrowser: runtime.requiresBrowser,
				confirmationState: task.requiresConfirmation ? "required" : "not_required",
				startedAt: new Date(),
				runtimeData: buildRuntimeData(task),
				metadata: {
					depth: task.depth,
					spawnedBySpecialist: task.spawnedBySpecialist ?? null,
					resourceLocks: task.resourceLocks,
					mutates: task.mutates,
					writesExternal: task.writesExternal,
				},
				eventPayload: {
					conversationId: config.conversationId,
					threadId: config.threadId ?? null,
					traceId: config.traceId,
					parentTaskId: task.parentTaskId ?? null,
					rootTaskId: task.rootTaskId,
					runtime: runtime.runtime,
					provider: runtime.provider,
				},
			}),
		)
	} catch (error) {
		console.error(
			"[task-persistence] Failed to persist task creation:",
			error instanceof Error ? error.message : String(error),
		)
	}
}

export async function persistTaskCompleted(
	query: TaskQueryFn,
	taskId: string,
	result: ExecutionTaskResult,
): Promise<void> {
	try {
		await Effect.runPromise(
			completeTaskRecord(query, {
				taskId,
				status:
					result.status === "completed"
						? "succeeded"
						: result.status === "partial"
							? "partial"
							: result.status === "escalate"
								? "escalated"
								: "failed",
				output: result.data,
				artifacts: result.artifacts,
				summary: result.summary,
				error: result.status === "failed" ? result.issues?.[0]?.message ?? result.summary : null,
				runtimeData: result.runtimeData ?? null,
				payload: {
					status: result.status,
					summary: result.summary,
					issues: result.issues,
				},
			}),
		)
	} catch (error) {
		console.error(
			"[task-persistence] Failed to persist task completion:",
			error instanceof Error ? error.message : String(error),
		)
	}
}
