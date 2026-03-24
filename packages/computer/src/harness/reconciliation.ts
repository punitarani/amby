import type { Database, DbError, TaskStatus } from "@amby/db"
import { and, eq, inArray, isNotNull, isNull, lt, ne, or, schema } from "@amby/db"
import type { Sandbox } from "@daytonaio/sdk"
import { Effect } from "effect"
import { STALE_HEARTBEAT_MS, TASK_BASE } from "../config"
import { CodexProvider } from "./codex-provider"
import { parseReplyTarget } from "./reply-target"
import { collectTaskExecutionData } from "./task-execution-data"
import { isTerminal, TERMINAL_STATUSES } from "./task-state"
import {
	completeTaskRecord,
	isSandboxTask,
	readSandboxRuntimeData,
	type TaskQueryFn,
} from "./task-store"
import { appendTaskTraceTerminalEvent } from "./task-trace"

type TaskRow = typeof schema.tasks.$inferSelect

export interface ReconciliationContext {
	db: Database
	ensureSandbox: (userId: string) => Promise<Sandbox>
	isDev: boolean
	/** If set, sends templated completion messages for Telegram tasks. */
	sendTelegram?: (chatId: number, text: string) => Promise<void>
}

const ACTIVE = ["preparing", "running"] as const

/** Intentionally module-level: CodexProvider is stateless (no mutable fields). */
const provider = new CodexProvider()

/** Skip probe-driven terminal updates when harness callbacks are still flowing recently. */
function shouldSkipProbeFinalize(task: TaskRow): boolean {
	if (task.lastEventSeq <= 0) return false
	if (!task.lastEventAt) return false
	const threshold = 2 * STALE_HEARTBEAT_MS
	return Date.now() - task.lastEventAt.getTime() < threshold
}

function statusJsonPath(taskId: string) {
	return `${TASK_BASE}/${taskId}/artifacts/status.json`
}

function parseStatusJson(raw: string | null): {
	status?: string
	exitCode?: number | null
	message?: string
} | null {
	if (!raw) return null
	try {
		return JSON.parse(raw) as { status?: string; exitCode?: number | null; message?: string }
	} catch {
		return null
	}
}

function buildNotificationMessage(task: TaskRow): string | null {
	const summary = task.outputSummary?.trim() || "Task finished."
	const err = task.error?.trim()
	switch (task.status) {
		case "succeeded":
			return `Your task is done.\n\n${summary}`
		case "failed":
			return `Your task failed.${err ? `\n\n${err}` : ""}\n\nYou can ask me to try again.`
		case "timed_out":
			return `Your task timed out. You can ask me to try again or split the work into smaller steps.`
		case "lost":
			return `I lost track of your task. You can ask me to start it again.`
		default:
			return null
	}
}

/** Force probe a single task (Daytona session + status.json) — used by probe_task tool. */
export async function probeSingleTask(ctx: ReconciliationContext, task: TaskRow): Promise<void> {
	const { db, ensureSandbox } = ctx
	if (!isSandboxTask(task)) {
		return
	}
	const sandbox = await ensureSandbox(task.userId)
	const query: TaskQueryFn = (fn) =>
		Effect.tryPromise({
			try: () => fn(db),
			catch: (error) => error as DbError,
		})
	const runtimeData = readSandboxRuntimeData(task)

	if (isTerminal(task.status as TaskStatus)) {
		return
	}

	if (!runtimeData?.sessionId || !runtimeData.commandId) {
		const completed = await Effect.runPromise(
			completeTaskRecord(query, {
				taskId: task.id,
				status: "lost",
				summary: "Task lost because session metadata is missing.",
				payload: { reason: "missing_session" },
			}),
		)
		if (completed) {
			await appendTaskTraceTerminalEvent({
				db,
				traceId: task.traceId,
				taskId: task.id,
				status: "lost",
				reason: "missing_session",
			}).catch(() => undefined)
			await insertMaintenanceEvent(db, task.id, {
				kind: "task.lost",
				payload: { reason: "missing_session" },
			})
		}
		return
	}

	try {
		const cmd = await sandbox.process.getSessionCommand(
			runtimeData.sessionId,
			runtimeData.commandId,
		)
		if (cmd.exitCode != null) {
			if (shouldSkipProbeFinalize(task)) {
				const skipNow = new Date()
				await db
					.update(schema.tasks)
					.set({ lastProbeAt: skipNow, updatedAt: skipNow })
					.where(eq(schema.tasks.id, task.id))
				await insertMaintenanceEvent(db, task.id, {
					kind: "maintenance.probe",
					payload: {
						exitCode: cmd.exitCode,
						source: "session_command",
						skipped: "active_callback_stream",
						lastEventSeq: task.lastEventSeq,
					},
				})
				return
			}

			const result = await collectTaskExecutionData({
				sandbox,
				provider,
				taskId: task.id,
				artifactRoot: runtimeData.artifactRoot ?? provider.getArtifactRoot(task.id),
			})
			const nextStatus: TaskStatus = cmd.exitCode === 0 ? "succeeded" : "failed"
			if (!isTerminal(task.status as TaskStatus)) {
				const completed = await Effect.runPromise(
					completeTaskRecord(query, {
						taskId: task.id,
						status: nextStatus,
						exitCode: cmd.exitCode,
						summary: result.summary.slice(0, 2000),
						output: result.output ? { result: result.output } : null,
						artifacts: result.artifacts,
						error: nextStatus === "failed" ? result.summary.slice(0, 4000) : null,
						payload: {
							exitCode: cmd.exitCode,
							source: "session_command",
							summary: result.summary,
						},
					}),
				)
				if (completed) {
					await appendTaskTraceTerminalEvent({
						db,
						traceId: task.traceId,
						taskId: task.id,
						status: nextStatus,
						message: result.summary,
						exitCode: cmd.exitCode,
					}).catch(() => undefined)
					await insertMaintenanceEvent(db, task.id, {
						kind: "maintenance.probe",
						payload: {
							exitCode: cmd.exitCode,
							source: "session_command",
						},
					})
				}
			}
			return
		}

		const raw = await sandbox.fs.downloadFile(statusJsonPath(task.id)).catch(() => null)
		const statusJson = parseStatusJson(raw?.toString("utf-8") ?? null)
		const trustStatusJson = task.lastEventSeq === 0

		if (
			trustStatusJson &&
			(statusJson?.status === "succeeded" || statusJson?.status === "failed")
		) {
			const result = await collectTaskExecutionData({
				sandbox,
				provider,
				taskId: task.id,
				artifactRoot: runtimeData.artifactRoot ?? provider.getArtifactRoot(task.id),
			})
			const success = statusJson.status === "succeeded"
			const nextStatus: TaskStatus = success ? "succeeded" : "failed"
			if (!isTerminal(task.status as TaskStatus)) {
				const completed = await Effect.runPromise(
					completeTaskRecord(query, {
						taskId: task.id,
						status: nextStatus,
						exitCode: statusJson.exitCode ?? (success ? 0 : 1),
						summary: result.summary.slice(0, 2000),
						output: result.output ? { result: result.output } : null,
						artifacts: result.artifacts,
						error: nextStatus === "failed" ? result.summary.slice(0, 4000) : null,
						payload: {
							source: "status_json",
							statusJson,
							summary: result.summary,
						},
					}),
				)
				if (completed) {
					await appendTaskTraceTerminalEvent({
						db,
						traceId: task.traceId,
						taskId: task.id,
						status: nextStatus,
						message: result.summary,
						exitCode: statusJson.exitCode ?? (success ? 0 : 1),
					}).catch(() => undefined)
					await insertMaintenanceEvent(db, task.id, {
						kind: "maintenance.probe",
						payload: {
							source: "status_json",
							statusJson,
						},
					})
				}
			}
		} else if (
			!trustStatusJson &&
			(statusJson?.status === "succeeded" || statusJson?.status === "failed")
		) {
			const naNow = new Date()
			await db
				.update(schema.tasks)
				.set({ lastProbeAt: naNow, updatedAt: naNow })
				.where(eq(schema.tasks.id, task.id))
			await insertMaintenanceEvent(db, task.id, {
				kind: "maintenance.probe",
				payload: {
					source: "still_running",
					statusJsonDebug: statusJson,
					note: "status_json_not_authoritative_lastEventSeq_gt_0",
				},
			})
		} else {
			const elseNow = new Date()
			await db
				.update(schema.tasks)
				.set({ lastProbeAt: elseNow, updatedAt: elseNow })
				.where(eq(schema.tasks.id, task.id))
			await insertMaintenanceEvent(db, task.id, {
				kind: "maintenance.probe",
				payload: { source: "still_running" },
			})
		}
	} catch (e) {
		console.error(`[probeSingleTask] failed for task ${task.id}:`, e)
		const errNow = new Date()
		await db
			.update(schema.tasks)
			.set({ lastProbeAt: errNow, updatedAt: errNow })
			.where(eq(schema.tasks.id, task.id))
	}
}

/**
 * Cron job: sandbox keep-alive, stale task reconciliation, Telegram notifications.
 */
export async function runScheduledReconciliation(ctx: ReconciliationContext): Promise<void> {
	const { db, ensureSandbox, sendTelegram } = ctx

	// --- 1) Keep-alive: refresh activity for each user with active tasks ---
	const activeRows = await db
		.selectDistinct({ userId: schema.tasks.userId })
		.from(schema.tasks)
		.where(and(eq(schema.tasks.runtime, "sandbox"), inArray(schema.tasks.status, [...ACTIVE])))

	const userIds = activeRows.map((r) => r.userId)
	const sandboxCache = new Map<string, Sandbox>()
	for (const uid of userIds) {
		try {
			const sb = await ensureSandbox(uid)
			sandboxCache.set(uid, sb)
			await sb.refreshActivity()
		} catch (e) {
			console.error(`[Reconciliation] refreshActivity failed for ${uid}:`, e)
		}
	}

	const staleBefore = new Date(Date.now() - STALE_HEARTBEAT_MS)

	// --- 2) Stale tasks: probe Daytona + status.json ---
	const staleTasks = await db
		.select()
		.from(schema.tasks)
		.where(
			and(
				eq(schema.tasks.runtime, "sandbox"),
				inArray(schema.tasks.status, [...ACTIVE]),
				or(isNull(schema.tasks.heartbeatAt), lt(schema.tasks.heartbeatAt, staleBefore)),
			),
		)

	const ctxWithCache: ReconciliationContext = {
		...ctx,
		ensureSandbox: async (userId) => {
			let sb = sandboxCache.get(userId)
			if (!sb) {
				sb = await ensureSandbox(userId)
				sandboxCache.set(userId, sb)
			}
			return sb
		},
	}

	for (const task of staleTasks) {
		try {
			await probeSingleTask(ctxWithCache, task)
		} catch (e) {
			console.error(`[Reconciliation] probe failed for task ${task.id}:`, e)
		}
	}

	// --- 3) Terminal completion notifications (channel-dispatched) ---
	if (!sendTelegram) return

	const pending = await db
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
		)

	for (const task of pending) {
		const target = parseReplyTarget(task.replyTarget)
		if (!target) {
			console.info(
				`[Reconciliation] skip notification for task ${task.id}: unparseable reply_target`,
			)
			continue
		}

		if (target.channel === "cli" || target.channel === "web") {
			console.info(
				`[Reconciliation] skip notification for task ${task.id}: channel "${target.channel}" not implemented`,
			)
			continue
		}

		if (target.channel !== "telegram") continue

		const chatId = target.chatId
		if (!Number.isFinite(chatId)) continue

		const text = buildNotificationMessage(task)
		if (!text) continue

		try {
			await sendTelegram(chatId, text)
			const notifyNow = new Date()
			await db
				.update(schema.tasks)
				.set({
					notifiedStatus: task.status,
					lastNotificationAt: notifyNow,
					updatedAt: notifyNow,
				})
				.where(eq(schema.tasks.id, task.id))
		} catch (e) {
			console.error(`[Reconciliation] Telegram notify failed for task ${task.id}:`, e)
		}
	}
}

async function insertMaintenanceEvent(
	db: Database,
	taskId: string,
	params: {
		kind?: "maintenance.probe" | "task.lost"
		payload: Record<string, unknown>
	},
) {
	const eventId = crypto.randomUUID()
	const occurredAt = new Date()
	await db.insert(schema.taskEvents).values({
		taskId,
		eventId,
		source: "maintenance",
		kind: params.kind ?? "maintenance.probe",
		seq: null,
		payload: params.payload,
		occurredAt,
	})
}
