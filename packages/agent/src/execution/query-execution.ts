import { isSandboxTask, isTerminal, type TaskSupervisor } from "@amby/computer"
import type { TaskRecord, TaskStoreService } from "@amby/core"
import type { Database } from "@amby/db"
import { and, type DbError, desc, eq, inArray, schema } from "@amby/db"
import { Effect } from "effect"
import type { QueryExecutionInput, QueryExecutionResult } from "../types/execution"
import type { JsonValue } from "../types/persistence"

type QueryFn = <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, DbError>

function parseArtifacts(value: unknown): QueryExecutionResult["executions"][number]["artifacts"] {
	if (!Array.isArray(value)) return undefined
	return value.filter(
		(item): item is { kind: string; title?: string; uri?: string } =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as { kind?: unknown }).kind === "string",
	)
}

function mapTaskRow(
	task: TaskRecord | typeof schema.tasks.$inferSelect,
): QueryExecutionResult["executions"][number] {
	return {
		taskId: task.id,
		specialist: (task.specialist ?? null) as import("@amby/core").SpecialistKind | null,
		status: task.status as import("@amby/core").TaskStatus,
		summary: (task.outputSummary ?? null) as string | null,
		output: task.output as JsonValue | undefined,
		traceId: task.traceId ?? null,
		runtime: task.runtime as import("@amby/core").TaskRuntime,
		provider: task.provider as import("@amby/core").TaskProvider,
		runnerKind: (task.runnerKind ?? null) as import("@amby/core").RunnerKind | null,
		requiresBrowser: task.requiresBrowser,
		startedAt: task.startedAt?.toISOString() ?? null,
		completedAt: task.completedAt?.toISOString() ?? null,
		lastEventAt: task.lastEventAt?.toISOString() ?? null,
		artifacts: parseArtifacts(task.artifacts),
	}
}

function mapTaskEventRow(event: {
	kind: string
	source: string
	seq?: number | null
	occurredAt: Date
	payload?: Record<string, unknown> | null
}): {
	kind: string
	source: string
	seq: number | null
	occurredAt: string
	payload?: JsonValue
} {
	return {
		kind: event.kind,
		source: event.source,
		seq: event.seq ?? null,
		occurredAt: event.occurredAt.toISOString(),
		payload: event.payload as JsonValue | undefined,
	}
}

export function queryExecution(params: {
	query: QueryFn
	taskStore: TaskStoreService
	supervisor: import("effect").Context.Tag.Service<typeof TaskSupervisor>
	userId: string
	conversationId: string
	input: QueryExecutionInput
}): Effect.Effect<
	QueryExecutionResult,
	import("@amby/core").DbError | DbError | import("@amby/computer").SandboxError
> {
	const { query, taskStore, supervisor, userId, conversationId, input } = params

	if (input.kind === "by-id") {
		return taskStore.getByIdAndUser(input.taskId, userId).pipe(
			Effect.flatMap(
				(
					task,
				): Effect.Effect<
					QueryExecutionResult,
					import("@amby/core").DbError | import("@amby/computer").SandboxError
				> => {
					if (!task) {
						return Effect.succeed({ executions: [] } as QueryExecutionResult)
					}
					const taskEffect =
						isSandboxTask(task) && !isTerminal(task.status)
							? supervisor.getTask(task.id, userId, input.waitSeconds)
							: Effect.succeed(task as TaskRecord | null)
					return Effect.all({
						task: taskEffect.pipe(Effect.map((value) => value ?? task)),
						recentEvents: taskStore
							.listRecentEvents(task.id, 10)
							.pipe(Effect.map((events) => events.map(mapTaskEventRow))),
					}).pipe(
						Effect.map(({ task: resolvedTask, recentEvents }) => ({
							executions: [
								{
									...mapTaskRow(resolvedTask),
									recentEvents,
								},
							],
						})),
					)
				},
			),
		)
	}

	const limit = Math.max(1, Math.min(input.limit ?? 5, 20))
	const activeStatuses = ["pending", "awaiting_auth", "preparing", "running"] as const
	return query((db) => {
		const where = input.includeCompleted
			? and(eq(schema.tasks.conversationId, conversationId), eq(schema.tasks.userId, userId))
			: and(
					eq(schema.tasks.conversationId, conversationId),
					eq(schema.tasks.userId, userId),
					inArray(schema.tasks.status, [...activeStatuses]),
				)
		return db
			.select()
			.from(schema.tasks)
			.where(where)
			.orderBy(desc(schema.tasks.createdAt))
			.limit(limit)
	}).pipe(
		Effect.map((rows) => ({
			executions: rows.map(mapTaskRow),
		})),
	)
}
