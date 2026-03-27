import type { TaskEventRecord, TaskRecord, TaskStoreService } from "@amby/core"
import { TaskStore, TERMINAL_STATUSES } from "@amby/core"
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or } from "drizzle-orm"
import { Effect, Layer } from "effect"
import type { DbError } from "../errors"
import * as schema from "../schema"
import { DbService } from "../service"

export const TaskStoreLive = Layer.effect(
	TaskStore,
	Effect.gen(function* () {
		const { query } = yield* DbService

		const service: TaskStoreService = {
			createTask: (params) => {
				const { eventPayload, id, ...taskValues } = params
				const taskId = id ?? crypto.randomUUID()
				return query(async (d) => {
					const createdAt = new Date()
					await d.transaction(async (tx) => {
						await tx.insert(schema.tasks).values({
							...taskValues,
							id: taskId,
						})
						await tx.insert(schema.taskEvents).values({
							taskId,
							eventId: crypto.randomUUID(),
							source: "server",
							kind: "task.created",
							seq: null,
							payload: eventPayload ?? {},
							occurredAt: createdAt,
						})
					})
				})
			},

			updateTask: (taskId, patch) =>
				query((d) => d.update(schema.tasks).set(patch).where(eq(schema.tasks.id, taskId))).pipe(
					Effect.asVoid,
				),

			appendEvent: (params) =>
				query((d) =>
					d.insert(schema.taskEvents).values({
						taskId: params.taskId,
						eventId: params.eventId ?? crypto.randomUUID(),
						source: params.source,
						kind: params.kind,
						seq: params.seq ?? null,
						payload: params.payload,
						occurredAt: params.occurredAt ?? new Date(),
					}),
				).pipe(Effect.asVoid),

			appendProgressEvent: (params) => {
				const occurredAt = params.occurredAt ?? new Date()
				return query(async (d) => {
					return await d.transaction(async (tx) => {
						const updated = await tx
							.update(schema.tasks)
							.set({
								...(params.status ? { status: params.status } : {}),
								lastEventSeq: params.seq,
								lastEventAt: occurredAt,
								heartbeatAt: occurredAt,
								updatedAt: new Date(),
							})
							.where(
								and(
									eq(schema.tasks.id, params.taskId),
									lt(schema.tasks.lastEventSeq, params.seq),
									notInArray(schema.tasks.status, TERMINAL_STATUSES),
								),
							)
							.returning({ id: schema.tasks.id })
						if (updated.length === 0) return false
						await tx.insert(schema.taskEvents).values({
							taskId: params.taskId,
							eventId: crypto.randomUUID(),
							source: params.source ?? "runtime",
							kind: params.kind ?? "task.progress",
							seq: params.seq,
							payload: params.payload,
							occurredAt,
						})
						return true
					})
				})
			},

			completeTask: (params) => {
				const now = new Date()
				return query(async (d) => {
					return await d.transaction(async (tx) => {
						let nextRuntimeData: Record<string, unknown> | null | undefined
						if (params.runtimeData) {
							const currentRows = await tx
								.select({ runtimeData: schema.tasks.runtimeData })
								.from(schema.tasks)
								.where(eq(schema.tasks.id, params.taskId))
								.limit(1)
							const current = currentRows[0]?.runtimeData
							const asRecord = (v: unknown): Record<string, unknown> =>
								v && typeof v === "object" ? (v as Record<string, unknown>) : {}
							const merged = Object.fromEntries(
								Object.entries({
									...asRecord(current),
									...params.runtimeData,
								}).filter(([, value]) => value !== undefined),
							)
							nextRuntimeData = Object.keys(merged).length > 0 ? merged : null
						}

						const terminalEventKind = (() => {
							switch (params.status) {
								case "succeeded":
									return "task.completed" as const
								case "partial":
									return "task.partial" as const
								case "escalated":
									return "task.escalated" as const
								case "failed":
									return "task.failed" as const
								case "timed_out":
									return "task.timed_out" as const
								case "lost":
									return "task.lost" as const
							}
						})()

						const updated = await tx
							.update(schema.tasks)
							.set({
								status: params.status,
								output: params.output,
								artifacts: params.artifacts,
								outputSummary: params.summary,
								error: params.error ?? undefined,
								exitCode: params.exitCode ?? undefined,
								completedAt: now,
								updatedAt: now,
								callbackSecretHash: null,
								...(nextRuntimeData !== undefined ? { runtimeData: nextRuntimeData } : {}),
							})
							.where(
								and(
									eq(schema.tasks.id, params.taskId),
									notInArray(schema.tasks.status, TERMINAL_STATUSES),
								),
							)
							.returning({ id: schema.tasks.id })
						if (updated.length === 0) return false

						await tx.insert(schema.taskEvents).values({
							taskId: params.taskId,
							eventId: crypto.randomUUID(),
							source: "server",
							kind: terminalEventKind,
							seq: null,
							payload: params.payload ?? {
								status: params.status,
								summary: params.summary,
							},
							occurredAt: now,
						})
						return true
					})
				})
			},

			listRecentEvents: (taskId, limit) =>
				query((d) =>
					d
						.select()
						.from(schema.taskEvents)
						.where(eq(schema.taskEvents.taskId, taskId))
						.orderBy(desc(schema.taskEvents.occurredAt), desc(schema.taskEvents.createdAt))
						.limit(limit),
				) as Effect.Effect<TaskEventRecord[], DbError>,

			getById: (taskId) =>
				query(async (d) => {
					const rows = await d
						.select()
						.from(schema.tasks)
						.where(eq(schema.tasks.id, taskId))
						.limit(1)
					return (rows[0] as TaskRecord | undefined) ?? null
				}),

			getByIdAndUser: (taskId, userId) =>
				query(async (d) => {
					const rows = await d
						.select()
						.from(schema.tasks)
						.where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)))
						.limit(1)
					return (rows[0] as TaskRecord | undefined) ?? null
				}),

			heartbeat: (taskId) => {
				const now = new Date()
				return query((d) =>
					d
						.update(schema.tasks)
						.set({ heartbeatAt: now, updatedAt: now })
						.where(eq(schema.tasks.id, taskId)),
				).pipe(Effect.asVoid)
			},

			touchProbe: (taskId) => {
				const now = new Date()
				return query((d) =>
					d
						.update(schema.tasks)
						.set({ lastProbeAt: now, updatedAt: now })
						.where(eq(schema.tasks.id, taskId)),
				).pipe(Effect.asVoid)
			},

			markNotified: (taskId, status) => {
				const now = new Date()
				return query((d) =>
					d
						.update(schema.tasks)
						.set({
							notifiedStatus: status,
							lastNotificationAt: now,
							updatedAt: now,
						})
						.where(eq(schema.tasks.id, taskId)),
				).pipe(Effect.asVoid)
			},

			countActiveSandboxTasks: (userId) =>
				query(async (d) => {
					const rows = await d
						.select({ id: schema.tasks.id })
						.from(schema.tasks)
						.where(
							and(
								eq(schema.tasks.userId, userId),
								eq(schema.tasks.runtime, "sandbox"),
								inArray(schema.tasks.status, ["preparing", "running"]),
							),
						)
					return rows.length
				}),

			findRunningSandboxTasks: () =>
				query((d) =>
					d
						.select()
						.from(schema.tasks)
						.where(and(eq(schema.tasks.status, "running"), eq(schema.tasks.runtime, "sandbox"))),
				) as Effect.Effect<TaskRecord[], DbError>,

			findStalePreparingSandboxTasks: (cutoff) =>
				query((d) =>
					d
						.select({ id: schema.tasks.id, traceId: schema.tasks.traceId })
						.from(schema.tasks)
						.where(
							and(
								eq(schema.tasks.status, "preparing"),
								eq(schema.tasks.runtime, "sandbox"),
								lte(schema.tasks.createdAt, cutoff),
							),
						),
				) as Effect.Effect<Array<{ id: string; traceId: string | null }>, DbError>,

			findActiveTaskUserIds: () =>
				query(async (d) => {
					const rows = await d
						.selectDistinct({ userId: schema.tasks.userId })
						.from(schema.tasks)
						.where(
							and(
								eq(schema.tasks.runtime, "sandbox"),
								inArray(schema.tasks.status, ["preparing", "running"]),
							),
						)
					return rows.map((r) => r.userId)
				}),

			findStaleSandboxTasks: (staleBefore) =>
				query((d) =>
					d
						.select()
						.from(schema.tasks)
						.where(
							and(
								eq(schema.tasks.runtime, "sandbox"),
								inArray(schema.tasks.status, ["preparing", "running"]),
								or(isNull(schema.tasks.heartbeatAt), lt(schema.tasks.heartbeatAt, staleBefore)),
							),
						),
				) as Effect.Effect<TaskRecord[], DbError>,

			findPendingNotifications: () =>
				query((d) =>
					d
						.select()
						.from(schema.tasks)
						.where(
							and(
								inArray(schema.tasks.status, [...TERMINAL_STATUSES]),
								isNotNull(schema.tasks.replyTarget),
								or(
									isNull(schema.tasks.notifiedStatus),
									ne(schema.tasks.notifiedStatus, schema.tasks.status),
								),
							),
						),
				) as Effect.Effect<TaskRecord[], DbError>,

			getConversationPlatform: (conversationId) =>
				query(async (d) => {
					const rows = await d
						.select({ platform: schema.conversations.platform })
						.from(schema.conversations)
						.where(eq(schema.conversations.id, conversationId))
						.limit(1)
					return rows[0]?.platform ?? null
				}),

			getTelegramChatId: (userId) =>
				query(async (d) => {
					const rows = await d
						.select({ telegramChatId: schema.accounts.telegramChatId })
						.from(schema.accounts)
						.where(
							and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "telegram")),
						)
						.limit(1)
					const raw = rows[0]?.telegramChatId
					if (!raw) {
						return null
					}
					const parsed = Number.parseInt(raw, 10)
					return Number.isFinite(parsed) ? parsed : null
				}),
		}

		return service
	}),
)
