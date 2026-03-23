import type { TaskSupervisor } from "@amby/computer"
import type { Database } from "@amby/db"
import { and, desc, eq, inArray, schema } from "@amby/db"
import { Effect } from "effect"
import type { QueryExecutionInput, QueryExecutionResult } from "../types/execution"

type QueryFn = <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, import("@amby/db").DbError>

function parseArtifacts(value: unknown): QueryExecutionResult["executions"][number]["artifacts"] {
	if (!Array.isArray(value)) return undefined
	return value.filter(
		(item): item is { kind: string; title?: string; uri?: string } =>
			typeof item === "object" && item !== null && typeof (item as { kind?: unknown }).kind === "string",
	)
}

function mapTaskRow(task: typeof schema.tasks.$inferSelect) {
	return {
		taskId: task.id,
		specialist: task.specialist ?? null,
		status: task.status,
		summary: task.outputSummary,
		traceId: task.traceId ?? null,
		startedAt: task.startedAt?.toISOString() ?? null,
		completedAt: task.completedAt?.toISOString() ?? null,
		lastEventAt: task.lastEventAt?.toISOString() ?? null,
		artifacts: parseArtifacts(task.artifacts),
	}
}

export function queryExecution(params: {
	query: QueryFn
	supervisor: import("effect").Context.Tag.Service<typeof TaskSupervisor>
	userId: string
	conversationId: string
	input: QueryExecutionInput
}): Effect.Effect<QueryExecutionResult, import("@amby/db").DbError | import("@amby/computer").SandboxError> {
	const { query, supervisor, userId, conversationId, input } = params

	if (input.kind === "by-id") {
		return supervisor.getTask(input.taskId, userId, input.waitSeconds).pipe(
			Effect.map((task) => ({
				executions: task ? [mapTaskRow(task)] : [],
			})),
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
		return db.select().from(schema.tasks).where(where).orderBy(desc(schema.tasks.createdAt)).limit(limit)
	}).pipe(
		Effect.map((rows) => ({
			executions: rows.map(mapTaskRow),
		})),
	)
}
