import type { TaskStatus } from "@amby/core"
import { TraceStore } from "@amby/core"
import { desc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as schema from "../schema"
import { DbService } from "../service"

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

export const TraceStoreLive = Layer.effect(
	TraceStore,
	Effect.gen(function* () {
		const { query } = yield* DbService

		return {
			appendTerminalEvent: (params) => {
				if (!params.traceId) return Effect.void

				const traceId = params.traceId
				return query(async (d) => {
					await d.transaction(async (tx) => {
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
				}).pipe(Effect.asVoid)
			},
		}
	}),
)
