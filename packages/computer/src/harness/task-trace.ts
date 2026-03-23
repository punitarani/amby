import type { Database, TaskStatus } from "@amby/db"
import { desc, eq, schema } from "@amby/db"

type TraceTerminalStatus = "completed" | "failed"

function toTraceTerminalStatus(status: TaskStatus): TraceTerminalStatus {
	return status === "succeeded" ? "completed" : "failed"
}

function toTraceEventKind(status: TaskStatus): "delegation_end" | "error" {
	return status === "succeeded" ? "delegation_end" : "error"
}

export async function appendTaskTraceTerminalEvent(params: {
	db: Database
	traceId?: string | null
	taskId: string
	status: TaskStatus
	message?: string | null
	exitCode?: number | null
	reason?: string | null
}) {
	if (!params.traceId) return

	const lastRows = await params.db
		.select({ seq: schema.traceEvents.seq })
		.from(schema.traceEvents)
		.where(eq(schema.traceEvents.traceId, params.traceId))
		.orderBy(desc(schema.traceEvents.seq))
		.limit(1)

	const nextSeq = (lastRows[0]?.seq ?? -1) + 1
	await params.db.insert(schema.traceEvents).values({
		traceId: params.traceId,
		seq: nextSeq,
		kind: toTraceEventKind(params.status),
		payload: {
			taskId: params.taskId,
			status: params.status,
			message: params.message ?? null,
			exitCode: params.exitCode ?? null,
			reason: params.reason ?? null,
		},
	})
	await params.db
		.update(schema.traces)
		.set({
			status: toTraceTerminalStatus(params.status),
			completedAt: new Date(),
		})
		.where(eq(schema.traces.id, params.traceId))
}
