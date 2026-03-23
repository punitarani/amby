import type { Database, TaskStatus } from "@amby/db"
import { desc, eq, schema } from "@amby/db"

type TraceTerminalStatus = "completed" | "failed"

function toTraceTerminalStatus(status: TaskStatus): TraceTerminalStatus {
	return status === "succeeded" || status === "partial" || status === "escalated"
		? "completed"
		: "failed"
}

function toTraceEventKind(status: TaskStatus): "delegation_end" | "error" {
	return status === "succeeded" || status === "partial" || status === "escalated"
		? "delegation_end"
		: "error"
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

	const traceId = params.traceId
	await params.db.transaction(async (tx) => {
		const lastRows = await tx
			.select({ seq: schema.traceEvents.seq })
			.from(schema.traceEvents)
			.where(eq(schema.traceEvents.traceId, traceId))
			.orderBy(desc(schema.traceEvents.seq))
			.limit(1)

		const nextSeq = (lastRows[0]?.seq ?? -1) + 1
		await tx.insert(schema.traceEvents).values({
			traceId,
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
		await tx
			.update(schema.traces)
			.set({
				status: toTraceTerminalStatus(params.status),
				completedAt: new Date(),
			})
			.where(eq(schema.traces.id, traceId))
	})
}
