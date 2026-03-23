import { type Database, type DbError, eq, schema, type TaskStatus } from "@amby/db"
import { Effect } from "effect"
import type { ExecutionTask, ExecutionTaskInput, ExecutionTaskResult } from "../types/execution"

type QueryFn = <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, DbError>

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

function mapResultStatus(status: ExecutionTaskResult["status"]): TaskStatus {
	switch (status) {
		case "completed":
		case "partial":
		case "escalate":
			return "succeeded"
		case "failed":
			return "failed"
	}
}

export async function persistTaskCreated(
	query: QueryFn,
	task: ExecutionTask,
	config: {
		userId: string
		conversationId: string
		threadId?: string
		traceId: string
	},
): Promise<void> {
	try {
		await Effect.runPromise(
			query((db) =>
				db.insert(schema.tasks).values({
					id: task.id,
					userId: config.userId,
					status: "running",
					specialist: task.specialist,
					runnerKind: task.runnerKind,
					conversationId: config.conversationId,
					threadId: config.threadId,
					traceId: config.traceId,
					rootTaskId: task.rootTaskId,
					parentTaskId: task.parentTaskId,
					input: task.input as unknown as Record<string, unknown>,
					prompt: derivePrompt(task.input),
					confirmationState: task.requiresConfirmation ? "required" : "not_required",
					startedAt: new Date(),
					metadata: {
						depth: task.depth,
						spawnedBySpecialist: task.spawnedBySpecialist ?? null,
						resourceLocks: task.resourceLocks,
						mutates: task.mutates,
						writesExternal: task.writesExternal,
					},
				}),
			),
		)

		const eventId = crypto.randomUUID()
		await Effect.runPromise(
			query((db) =>
				db.insert(schema.taskEvents).values({
					taskId: task.id,
					eventId,
					source: "server",
					kind: "task.created",
					seq: null,
					payload: {
						conversationId: config.conversationId,
						threadId: config.threadId ?? null,
						traceId: config.traceId,
						parentTaskId: task.parentTaskId ?? null,
						rootTaskId: task.rootTaskId,
					},
					occurredAt: new Date(),
				}),
			),
		)
	} catch (error) {
		console.error(
			"[task-persistence] Failed to persist task creation:",
			error instanceof Error ? error.message : String(error),
		)
	}
}

export async function persistTaskCompleted(
	query: QueryFn,
	taskId: string,
	result: ExecutionTaskResult,
): Promise<void> {
	try {
		const status = mapResultStatus(result.status)
		const now = new Date()

		await Effect.runPromise(
			query((db) =>
				db
					.update(schema.tasks)
					.set({
						status,
						output: result.data as unknown as Record<string, unknown>,
						artifacts: result.artifacts as unknown as Record<string, unknown>,
						outputSummary: result.summary,
						...(status === "failed"
							? { error: result.issues?.[0]?.message ?? result.summary }
							: {}),
						completedAt: now,
						updatedAt: now,
					})
					.where(eq(schema.tasks.id, taskId)),
			),
		)

		const eventKind = status === "failed" ? "task.failed" : "task.completed"
		const eventId = crypto.randomUUID()
		await Effect.runPromise(
			query((db) =>
				db.insert(schema.taskEvents).values({
					taskId,
					eventId,
					source: "server",
					kind: eventKind,
					seq: null,
					payload: {
						status: result.status,
						summary: result.summary,
					},
					occurredAt: now,
				}),
			),
		)
	} catch (error) {
		console.error(
			"[task-persistence] Failed to persist task completion:",
			error instanceof Error ? error.message : String(error),
		)
	}
}
