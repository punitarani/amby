import {
	CALLBACK_HEARTBEAT_INTERVAL_MS,
	hashSecret,
	isLegalTransition,
	isTerminal,
	isTimestampValid,
	verifyHmacSignature,
} from "@amby/computer"
import type { TaskEventSource, TaskStatus } from "@amby/db"
import { DbService, eq, schema } from "@amby/db"
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

function sourceFromEventType(eventType: string): TaskEventSource {
	if (eventType.startsWith("codex.")) return "codex_notify"
	if (eventType.startsWith("task.")) return "harness"
	return "harness"
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
		case "task.failed":
			return "failed"
		default:
			return undefined
	}
}

export const handleTaskEventPost = (request: Request) =>
	Effect.gen(function* () {
		const { db } = yield* DbService

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
		/** Monotonic `seq` applies only to harness-originated events; `codex.notify` uses `seq: null`. */
		const isHarnessSeq = typeof seq === "number" && Number.isFinite(seq)
		if (isHarnessSeq && seq <= task.lastEventSeq) {
			return jsonResponse(
				{
					ack: true,
					cancelRequested: false,
					nextHeartbeatMs: CALLBACK_HEARTBEAT_INTERVAL_MS,
				},
				200,
			)
		}

		const occurredAt = body.sentAt ? new Date(body.sentAt) : new Date()
		const source = sourceFromEventType(body.eventType)

		const inserted = yield* Effect.promise(async () => {
			try {
				await db.insert(schema.taskEvents).values({
					taskId: task.id,
					eventId: body.eventId,
					source,
					eventType: body.eventType,
					seq: seq ?? null,
					payload: body.payload ?? {
						status: body.status,
						message: body.message,
						exitCode: body.exitCode,
					},
					occurredAt,
				})
				return true
			} catch (e) {
				console.error("[task-events] insert skipped:", e)
				return false
			}
		})
		if (!inserted) {
			return jsonResponse(
				{
					ack: true,
					cancelRequested: false,
					nextHeartbeatMs: CALLBACK_HEARTBEAT_INTERVAL_MS,
				},
				200,
			)
		}

		if (body.eventType === "codex.notify") {
			yield* Effect.tryPromise({
				try: () =>
					db
						.update(schema.tasks)
						.set({
							lastEventAt: occurredAt,
							updatedAt: new Date(),
						})
						.where(eq(schema.tasks.id, task.id)),
				catch: () => undefined,
			})
		} else {
			const nextStatus = mapHarnessEventToStatus(body.eventType)
			const fromStatus = task.status as TaskStatus
			const statusOk = !nextStatus || isLegalTransition(fromStatus, nextStatus)
			const heartbeatAt = new Date()
			const patch: Partial<typeof schema.tasks.$inferInsert> = {
				lastEventSeq: isHarnessSeq ? seq : task.lastEventSeq,
				lastEventAt: occurredAt,
				heartbeatAt,
				updatedAt: new Date(),
			}

			if (nextStatus && statusOk) {
				patch.status = nextStatus
			}

			if (statusOk && (body.eventType === "task.completed" || body.eventType === "task.failed")) {
				patch.completedAt = occurredAt
				patch.exitCode = body.exitCode ?? (body.eventType === "task.completed" ? 0 : 1)
				patch.callbackSecretHash = null
				if (body.message) {
					patch.outputSummary = body.message.slice(0, 2000)
				}
			}

			yield* Effect.tryPromise({
				try: () => db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, task.id)),
				catch: () => undefined,
			})
		}

		return jsonResponse(
			{
				ack: true,
				cancelRequested: false,
				nextHeartbeatMs: CALLBACK_HEARTBEAT_INTERVAL_MS,
			},
			200,
		)
	})
