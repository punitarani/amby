import { isSandboxTask, isTerminal, listRecentTaskEvents, type TaskSupervisor } from "@amby/computer"
import type { Database } from "@amby/db"
import { and, desc, eq, inArray, schema } from "@amby/db"
import { Effect } from "effect"
import type { QueryExecutionInput, QueryExecutionResult } from "../types/execution"
import type { JsonValue } from "../types/persistence"

type QueryFn = <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, import("@amby/db").DbError>

function parseArtifacts(value: unknown): QueryExecutionResult["executions"][number]["artifacts"] {
	if (!Array.isArray(value)) return undefined
	return value.filter(
		(item): item is { kind: string; title?: string; uri?: string } =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as { kind?: unknown }).kind === "string",
	)
}

function mapTaskRow(task: typeof schema.tasks.$inferSelect) {
	return {
		taskId: task.id,
		specialist: task.specialist ?? null,
		status: task.status,
		summary: task.outputSummary,
		output: task.output as JsonValue | undefined,
		traceId: task.traceId ?? null,
		runtime: task.runtime,
		provider: task.provider,
		runnerKind: task.runnerKind ?? null,
		requiresBrowser: task.requiresBrowser,
		startedAt: task.startedAt?.toISOString() ?? null,
		completedAt: task.completedAt?.toISOString() ?? null,
		lastEventAt: task.lastEventAt?.toISOString() ?? null,
		artifacts: parseArtifacts(task.artifacts),
	}
}

function mapTaskEventRow(event: typeof schema.taskEvents.$inferSelect) {
	return {
		kind: event.kind,
		source: event.source,
		seq: event.seq,
		occurredAt: event.occurredAt.toISOString(),
		payload: event.payload as JsonValue | undefined,
	}
}

export function queryExecution(params: {
	query: QueryFn
	supervisor: import("effect").Context.Tag.Service<typeof TaskSupervisor>
	userId: string
	conversationId: string
	input: QueryExecutionInput
}): Effect.Effect<
	QueryExecutionResult,
	import("@amby/db").DbError | import("@amby/computer").SandboxError
> {
	const { query, supervisor, userId, conversationId, input } = params

	if (input.kind === "by-id") {
		return query((db) =>
			db
				.select()
				.from(schema.tasks)
				.where(and(eq(schema.tasks.id, input.taskId), eq(schema.tasks.userId, userId)))
				.limit(1),
		).pipe(
			Effect.flatMap((rows) => {
				const task = rows[0] ?? null
				if (!task) {
					return Effect.succeed<QueryExecutionResult>({ executions: [] })
				}
				const taskEffect =
					isSandboxTask(task) && !isTerminal(task.status)
						? supervisor.getTask(task.id, userId, input.waitSeconds)
						: Effect.succeed(task)
				return Effect.all({
					task: taskEffect.pipe(Effect.map((value) => value ?? task)),
					recentEvents: listRecentTaskEvents(query, task.id, 10).pipe(
						Effect.map((events) => events.map(mapTaskEventRow)),
					),
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
			}),
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
