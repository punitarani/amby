import {
	appendTaskTraceTerminalEvent,
	CALLBACK_HEARTBEAT_INTERVAL_MS,
	hashSecret,
	isLegalTransition,
	isTerminal,
	isTimestampValid,
	TaskSupervisor,
	TERMINAL_STATUSES,
	verifyHmacSignature,
} from "@amby/computer"
import type { TaskEventKind, TaskEventSource, TaskStatus } from "@amby/db"
import { and, DbService, eq, lt, notInArray, schema } from "@amby/db"
import { Effect } from "effect"

type TaskEventBody = {
	eventId: string
	eventType: string
	taskId: string
	status?: string | null
	message?: string | null
	seq?: number | null
	exitCode?: number | null
	sentAt?: string
	payload?: Record<string, unknown>
}

const jsonHeaders = { "Content-Type": "application/json" } as const

function jsonResponse(body: Record<string, unknown>, status: number): Response {
	return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function ackResponse() {
	return jsonResponse(
		{
			ack: true,
			cancelRequested: false,
			nextHeartbeatMs: CALLBACK_HEARTBEAT_INTERVAL_MS,
		},
		200,
	)
}

function sourceFromEventType(eventType: string): TaskEventSource {
	if (eventType === "codex.notify" || eventType === "backend.notify") return "backend"
	if (eventType.startsWith("task.")) return "runtime"
	return "runtime"
}

const KNOWN_EVENT_KINDS: Set<string> = new Set([
	"task.created",
	"task.started",
	"task.progress",
	"task.heartbeat",
	"task.completed",
	"task.partial",
	"task.escalated",
	"task.failed",
	"task.timed_out",
	"task.lost",
	"task.notification_sent",
	"backend.notify",
	"maintenance.probe",
])

function normalizeEventKind(eventType: string): TaskEventKind | null {
	switch (eventType) {
		case "codex.notify":
			return "backend.notify"
		case "reconciler.probe":
			return "maintenance.probe"
		default:
			if (!KNOWN_EVENT_KINDS.has(eventType)) return null
			return eventType as TaskEventKind
	}
}

function mapHarnessEventToStatus(eventType: string): TaskStatus | undefined {
	switch (eventType) {
		case "task.started":
			return "running"
		case "task.heartbeat":
		case "task.progress":
			return "running"
		case "task.completed":
			return "succeeded"
		case "task.partial":
			return "partial"
		case "task.escalated":
			return "escalated"
		case "task.failed":
			return "failed"
		default:
			return undefined
	}
}

export const handleTaskEventPost = (request: Request) =>
	Effect.gen(function* () {
		const { db } = yield* DbService
		const taskSupervisor = yield* TaskSupervisor

		const rawBody = yield* Effect.tryPromise({
			try: () => request.text(),
			catch: () => new Error("invalid body"),
		})

		const callbackId = request.headers.get("x-amby-callback-id")
		const timestamp = request.headers.get("x-amby-timestamp")
		const signature = request.headers.get("x-amby-signature")
		const auth = request.headers.get("authorization")

		if (!callbackId || !timestamp || !signature || !auth?.startsWith("Bearer ")) {
			return jsonResponse({ error: "Unauthorized" }, 401)
		}

		const bearer = auth.slice("Bearer ".length).trim()

		const taskRows = yield* Effect.tryPromise({
			try: () =>
				db.select().from(schema.tasks).where(eq(schema.tasks.callbackId, callbackId)).limit(1),
			catch: () => new Error("db"),
		})
		const task = taskRows[0]
		if (!task) {
			return jsonResponse({ error: "Not found" }, 404)
		}

		if (isTerminal(task.status as TaskStatus)) {
			return jsonResponse({ error: "Task not accepting events" }, 409)
		}

		if (!task.callbackSecretHash) {
			return jsonResponse({ error: "Unauthorized" }, 401)
		}

		const bearerHash = yield* Effect.tryPromise({
			try: () => hashSecret(bearer),
			catch: () => new Error("hash"),
		})
		if (bearerHash !== task.callbackSecretHash) {
			return jsonResponse({ error: "Unauthorized" }, 401)
		}

		const ts = Number(timestamp)
		if (!isTimestampValid(ts)) {
			return jsonResponse({ error: "Unauthorized" }, 401)
		}

		const okSig = yield* Effect.tryPromise({
			try: () => verifyHmacSignature(rawBody, bearer, timestamp, signature),
			catch: () => false,
		})
		if (!okSig) {
			return jsonResponse({ error: "Unauthorized" }, 401)
		}

		let body: TaskEventBody
		try {
			body = JSON.parse(rawBody) as TaskEventBody
		} catch {
			return jsonResponse({ error: "Invalid JSON" }, 400)
		}

		if (body.taskId !== task.id) {
			return jsonResponse({ error: "Task mismatch" }, 400)
		}

		const seq = body.seq
		/** Monotonic `seq` applies to runtime-originated callback streams only. */
		const isRuntimeSeq = typeof seq === "number" && Number.isFinite(seq)
		if (isRuntimeSeq && seq <= task.lastEventSeq) {
			return ackResponse()
		}

		const occurredAt = body.sentAt ? new Date(body.sentAt) : new Date()
		const source = sourceFromEventType(body.eventType)
		const kind = normalizeEventKind(body.eventType)
		if (!kind) {
			return jsonResponse({ error: `Unknown event kind: ${body.eventType}` }, 400)
		}
		const eventPayload = body.payload ?? {
			status: body.status,
			message: body.message,
			exitCode: body.exitCode,
		}

		if (kind === "backend.notify") {
			const inserted = yield* Effect.promise(async () => {
				try {
					await db.transaction(async (tx) => {
						await tx.insert(schema.taskEvents).values({
							taskId: task.id,
							eventId: body.eventId,
							source,
							kind,
							seq: null,
							payload: eventPayload,
							occurredAt,
						})
						await tx
							.update(schema.tasks)
							.set({
								lastEventAt: occurredAt,
								updatedAt: new Date(),
							})
							.where(
								and(
									eq(schema.tasks.id, task.id),
									notInArray(schema.tasks.status, TERMINAL_STATUSES),
								),
							)
					})
					return true
				} catch (e) {
					console.error("[task-events] backend notify skipped:", e)
					return false
				}
			})
			void inserted
		} else {
			const nextStatus = mapHarnessEventToStatus(body.eventType)
			const fromStatus = task.status as TaskStatus
			const statusOk = !nextStatus || isLegalTransition(fromStatus, nextStatus)
			const now = new Date()
			const patch: Partial<typeof schema.tasks.$inferInsert> = {
				lastEventSeq: isRuntimeSeq ? seq : task.lastEventSeq,
				lastEventAt: occurredAt,
				heartbeatAt: now,
				updatedAt: now,
			}

			if (nextStatus && statusOk) {
				patch.status = nextStatus
			}

			if (
				statusOk &&
				(kind === "task.completed" ||
					kind === "task.partial" ||
					kind === "task.escalated" ||
					kind === "task.failed")
			) {
				const executionData = yield* taskSupervisor
					.getTaskExecutionData(task.id, task.userId)
					.pipe(Effect.catchAll(() => Effect.succeed(null)))
				patch.completedAt = occurredAt
				patch.exitCode = body.exitCode ?? (kind === "task.failed" ? 1 : 0)
				patch.callbackSecretHash = null
				if (executionData) {
					patch.output = executionData.output ? { result: executionData.output } : null
					patch.artifacts = executionData.artifacts
					patch.outputSummary = executionData.summary.slice(0, 2000)
					if (kind === "task.failed") {
						patch.error = executionData.summary.slice(0, 4000)
					}
				} else if (body.message) {
					patch.outputSummary = body.message.slice(0, 2000)
					if (kind === "task.failed") {
						patch.error = body.message.slice(0, 4000)
					}
				}
			}

			const applied = yield* Effect.promise(async () => {
				try {
					return await db.transaction(async (tx) => {
						const updated = await tx
							.update(schema.tasks)
							.set(patch)
							.where(
								isRuntimeSeq
									? and(
											eq(schema.tasks.id, task.id),
											lt(schema.tasks.lastEventSeq, seq),
											notInArray(schema.tasks.status, TERMINAL_STATUSES),
										)
									: and(
											eq(schema.tasks.id, task.id),
											notInArray(schema.tasks.status, TERMINAL_STATUSES),
										),
							)
							.returning({ id: schema.tasks.id })
						if (updated.length === 0) {
							return false
						}
						await tx.insert(schema.taskEvents).values({
							taskId: task.id,
							eventId: body.eventId,
							source,
							kind,
							seq: isRuntimeSeq ? seq : null,
							payload: eventPayload,
							occurredAt,
						})
						return true
					})
				} catch (e) {
					console.error("[task-events] runtime event skipped:", e)
					return false
				}
			})
			if (!applied) {
				return ackResponse()
			}

			const traceId = task.traceId
			if (
				statusOk &&
				traceId &&
				(kind === "task.completed" ||
					kind === "task.partial" ||
					kind === "task.escalated" ||
					kind === "task.failed")
			) {
				yield* Effect.tryPromise({
					try: () =>
						appendTaskTraceTerminalEvent({
							db,
							traceId,
							taskId: task.id,
							status: nextStatus ?? (kind === "task.failed" ? "failed" : "succeeded"),
							message: body.message ?? null,
							exitCode: body.exitCode ?? null,
						}),
					catch: (error) => {
						console.error("[task-events] failed to append trace terminal event:", error)
						return undefined
					},
				})
			}
		}

		return ackResponse()
	})
