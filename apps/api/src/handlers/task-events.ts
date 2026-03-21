import { hashSecret, isTimestampValid, verifyHmac } from "@amby/computer"
import type { TaskEventType, TaskStatus } from "@amby/db"
import { DbService, eq, schema } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"

const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "timed_out", "lost"] as const

type TerminalStatus = (typeof TERMINAL_STATUSES)[number]

const ALL_TASK_STATUSES: TaskStatus[] = [
	"pending",
	"awaiting_auth",
	"preparing",
	"running",
	"succeeded",
	"failed",
	"cancelled",
	"timed_out",
	"lost",
]

function isTaskStatus(s: string): s is TaskStatus {
	return (ALL_TASK_STATUSES as readonly string[]).includes(s)
}

function isTerminalStatus(s: string): s is TerminalStatus {
	return (TERMINAL_STATUSES as readonly string[]).includes(s)
}

function parseBearer(authHeader: string | undefined): string | null {
	if (!authHeader?.startsWith("Bearer ")) return null
	const token = authHeader.slice("Bearer ".length).trim()
	return token.length > 0 ? token : null
}

export async function handleTaskEventsRequest(
	env: WorkerBindings,
	rawBody: string,
	headers: {
		taskId: string | undefined
		timestamp: string | undefined
		seq: string | undefined
		signature: string | undefined
		authorization: string | undefined
	},
): Promise<{ status: number; body: Record<string, unknown> }> {
	const taskId = headers.taskId
	const tsRaw = headers.timestamp
	const seqRaw = headers.seq
	const signature = headers.signature
	const bearer = parseBearer(headers.authorization)

	if (!taskId || !tsRaw || !seqRaw || !signature || !bearer) {
		return { status: 401, body: { error: "Unauthorized" } }
	}

	const seq = Number.parseInt(seqRaw, 10)
	const timestampMs = Number.parseInt(tsRaw, 10)
	if (!Number.isFinite(seq) || !Number.isFinite(timestampMs)) {
		return { status: 401, body: { error: "Unauthorized" } }
	}

	if (!isTimestampValid(timestampMs)) {
		return { status: 401, body: { error: "Unauthorized" } }
	}

	const verifiedHmac = await verifyHmac(rawBody, bearer, signature)
	if (!verifiedHmac) {
		return { status: 401, body: { error: "Unauthorized" } }
	}

	const presentedHash = await hashSecret(bearer)

	let parsed: {
		eventType?: string
		taskId?: string
		status?: string
		message?: string
		exitCode?: number | null
	}
	try {
		parsed = JSON.parse(rawBody) as typeof parsed
	} catch {
		return { status: 400, body: { error: "Invalid JSON" } }
	}

	const eventType = parsed.eventType as TaskEventType | undefined
	if (!eventType || parsed.taskId !== taskId) {
		return { status: 400, body: { error: "Invalid payload" } }
	}

	const runtime = makeRuntimeForConsumer(env)

	try {
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const { query } = yield* DbService

				const rows = yield* query((d) =>
					d.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1),
				)

				const task = rows[0]
				if (!task) {
					return { kind: "not_found" as const }
				}

				if (isTerminalStatus(task.status)) {
					return { kind: "terminal" as const }
				}

				if (task.callbackTokenExpiresAt && task.callbackTokenExpiresAt.getTime() < Date.now()) {
					return { kind: "expired_token" as const }
				}

				if (!task.callbackTokenHash || presentedHash !== task.callbackTokenHash) {
					return { kind: "bad_secret" as const }
				}

				if (seq <= task.lastEventSeq) {
					return { kind: "idempotent_ok" as const }
				}

				const now = new Date()

				yield* query((d) =>
					d
						.insert(schema.taskEvents)
						.values({
							taskId,
							seq,
							eventType,
							status: parsed.status ?? null,
							message: parsed.message ?? null,
							exitCode: parsed.exitCode ?? null,
							payload: parsed as Record<string, unknown>,
							receivedAt: now,
						})
						.onConflictDoNothing({ target: [schema.taskEvents.taskId, schema.taskEvents.seq] }),
				)

				const baseUpdate = {
					lastEventSeq: seq,
					heartbeatAt: now,
					updatedAt: now,
				}

				if (eventType === "task.completed") {
					yield* query((d) =>
						d
							.update(schema.tasks)
							.set({
								...baseUpdate,
								status: "succeeded",
								completedAt: now,
								exitCode: parsed.exitCode ?? 0,
								callbackTokenExpiresAt: now,
							})
							.where(eq(schema.tasks.id, taskId)),
					)
				} else if (eventType === "task.failed") {
					yield* query((d) =>
						d
							.update(schema.tasks)
							.set({
								...baseUpdate,
								status: "failed",
								completedAt: now,
								exitCode: parsed.exitCode ?? 1,
								callbackTokenExpiresAt: now,
							})
							.where(eq(schema.tasks.id, taskId)),
					)
				} else {
					const progressStatus =
						eventType === "task.progress" && parsed.status && isTaskStatus(parsed.status)
							? parsed.status
							: undefined
					yield* query((d) =>
						d
							.update(schema.tasks)
							.set({
								...baseUpdate,
								...(progressStatus ? { status: progressStatus } : {}),
							})
							.where(eq(schema.tasks.id, taskId)),
					)
				}

				return { kind: "ok" as const }
			}),
		)

		if (result.kind === "not_found") return { status: 404, body: { error: "Not found" } }
		if (result.kind === "terminal") return { status: 409, body: { error: "Task already terminal" } }
		if (result.kind === "expired_token" || result.kind === "bad_secret")
			return { status: 401, body: { error: "Unauthorized" } }
		if (result.kind === "idempotent_ok")
			return { status: 200, body: { ok: true, idempotent: true } }
		return { status: 200, body: { ok: true } }
	} finally {
		await runtime.dispose()
	}
}
