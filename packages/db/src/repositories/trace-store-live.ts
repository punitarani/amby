import type { TaskStatus } from "@amby/core"
import { TraceStore } from "@amby/core"
import { desc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as schema from "../schema"
import { DbService } from "../service"

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

export const TraceStoreLive = Layer.effect(
	TraceStore,
	Effect.gen(function* () {
		const { query } = yield* DbService

		return {
			appendTerminalEvent: (params) => {
				if (!params.traceId) return Effect.void

				const runId = params.traceId
				return query(async (d) => {
					await d.transaction(async (tx) => {
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
				}).pipe(Effect.asVoid)
			},
		}
	}),
)
