import type { Database, TaskStatus } from "@amby/db"
import { desc, eq, schema } from "@amby/db"

type RunTerminalStatus = "completed" | "failed"

function toRunTerminalStatus(status: TaskStatus): RunTerminalStatus {
	return status === "succeeded" || status === "partial" || status === "escalated"
		? "completed"
		: "failed"
}

function toRunEventKind(status: TaskStatus): "delegation_end" | "error" {
	return status === "succeeded" || status === "partial" || status === "escalated"
		? "delegation_end"
		: "error"
}

export async function appendTaskRunTerminalEvent(params: {
	db: Database
	runId?: string | null
	taskId: string
	status: TaskStatus
	message?: string | null
	exitCode?: number | null
	reason?: string | null
}) {
	if (!params.runId) return

	const runId = params.runId
	await params.db.transaction(async (tx) => {
		const lastRows = await tx
			.select({ seq: schema.runEvents.seq })
			.from(schema.runEvents)
			.where(eq(schema.runEvents.runId, runId))
			.orderBy(desc(schema.runEvents.seq))
			.limit(1)

		const nextSeq = (lastRows[0]?.seq ?? -1) + 1
		await tx.insert(schema.runEvents).values({
			runId,
			seq: nextSeq,
			kind: toRunEventKind(params.status),
			payload: {
				taskId: params.taskId,
				status: params.status,
				message: params.message ?? null,
				exitCode: params.exitCode ?? null,
				reason: params.reason ?? null,
			},
		})
		await tx
			.update(schema.runs)
			.set({
				status: toRunTerminalStatus(params.status),
				completedAt: new Date(),
			})
			.where(eq(schema.runs.id, runId))
	})
}

/**
 * @deprecated Use appendTaskRunTerminalEvent instead.
 * Compatibility wrapper that maps the old traceId parameter to runId.
 */
export async function appendTaskTraceTerminalEvent(params: {
	db: Database
	traceId?: string | null
	taskId: string
	status: TaskStatus
	message?: string | null
	exitCode?: number | null
	reason?: string | null
}) {
	return appendTaskRunTerminalEvent({
		db: params.db,
		runId: params.traceId,
		taskId: params.taskId,
		status: params.status,
		message: params.message,
		exitCode: params.exitCode,
		reason: params.reason,
	})
}
