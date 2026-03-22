import type { Database, TaskStatus } from "@amby/db"
import { and, eq, inArray, isNotNull, isNull, lt, ne, notInArray, or, schema } from "@amby/db"
import type { Sandbox } from "@daytonaio/sdk"
import { DaytonaNotFoundError } from "@daytonaio/sdk"
import { STALE_HEARTBEAT_MS, TASK_BASE } from "../config"
import { deleteHarnessOtelKey } from "./braintrust-otel"
import { CodexProvider } from "./codex-provider"
import { parseReplyTarget } from "./reply-target"
import { isTerminal, TERMINAL_STATUSES } from "./task-state"

type TaskRow = typeof schema.tasks.$inferSelect

export interface ReconciliationContext {
	db: Database
	ensureSandbox: (userId: string) => Promise<Sandbox>
	isDev: boolean
	/** If set, sends templated completion messages for Telegram tasks. */
	sendTelegram?: (chatId: number, text: string) => Promise<void>
	/** If set, used to delete per-task Braintrust OTEL keys on task termination. */
	braintrustHarnessApiKey?: string
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

async function touchProbeTimestamp(db: Database, taskId: string) {
	const now = new Date()
	await db
		.update(schema.tasks)
		.set({ lastProbeAt: now, updatedAt: now })
		.where(eq(schema.tasks.id, taskId))
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
			return `Your background task is done.\n\n${summary}`
		case "failed":
			return `Your background task failed.${err ? `\n\n${err}` : ""}\n\nYou can ask me to try again.`
		case "timed_out":
			return `Your background task timed out. You can ask me to try again or split the work into smaller steps.`
		case "lost":
			return `I lost track of your background task. You can ask me to start it again.`
		default:
			return null
	}
}

function nonTerminalTaskWhere(taskId: string) {
	return and(eq(schema.tasks.id, taskId), notInArray(schema.tasks.status, TERMINAL_STATUSES))
}

async function deleteOtelKeyForTask(ctx: ReconciliationContext, taskId: string): Promise<void> {
	const { db, braintrustHarnessApiKey } = ctx
	if (!braintrustHarnessApiKey) return
	try {
		const rows = await db
			.select({ metadata: schema.tasks.metadata })
			.from(schema.tasks)
			.where(eq(schema.tasks.id, taskId))
			.limit(1)
		const keyId = rows[0]?.metadata?.otelKeyId
		if (typeof keyId !== "string") return
		await deleteHarnessOtelKey(braintrustHarnessApiKey, keyId)
		await db.update(schema.tasks).set({ metadata: null }).where(eq(schema.tasks.id, taskId))
	} catch (e) {
		console.warn(`[Reconciliation] Failed to delete OTEL key for task ${taskId}:`, e)
	}
}

/** Force probe a single task (Daytona session + status.json) — used by probe_task tool. */
export async function probeSingleTask(ctx: ReconciliationContext, task: TaskRow): Promise<void> {
	const { db, ensureSandbox } = ctx
	const sandbox = await ensureSandbox(task.userId)

	if (isTerminal(task.status as TaskStatus)) {
		return
	}

	if (!task.sessionId || !task.commandId) {
		const now = new Date()
		await db
			.update(schema.tasks)
			.set({
				status: "lost",
				error: "Task lost: missing session or command ID",
				completedAt: now,
				updatedAt: now,
			})
			.where(nonTerminalTaskWhere(task.id))
		await insertReconcilerEvent(db, task.id, "task.lost", { reason: "missing_session" })
		await deleteOtelKeyForTask(ctx, task.id)
		return
	}

	try {
		const cmd = await sandbox.process.getSessionCommand(task.sessionId, task.commandId)
		if (cmd.exitCode != null) {
			if (shouldSkipProbeFinalize(task)) {
				await touchProbeTimestamp(db, task.id)
				await insertReconcilerEvent(db, task.id, "reconciler.probe", {
					exitCode: cmd.exitCode,
					source: "session_command",
					skipped: "active_callback_stream",
					lastEventSeq: task.lastEventSeq,
				})
				return
			}

			const result = await provider.collectResult(sandbox, provider.getArtifactRoot(task.id))
			const nextStatus: TaskStatus = cmd.exitCode === 0 ? "succeeded" : "failed"
			const probeNow = new Date()
			const updated = await db
				.update(schema.tasks)
				.set({
					status: nextStatus,
					exitCode: cmd.exitCode,
					outputSummary: result.summary.slice(0, 2000),
					error:
						cmd.exitCode !== 0
							? (result.stderr || "Task failed with no error output").slice(0, 2000)
							: null,
					completedAt: probeNow,
					heartbeatAt: probeNow,
					updatedAt: probeNow,
					callbackSecretHash: null,
				})
				.where(nonTerminalTaskWhere(task.id))
				.returning({ id: schema.tasks.id })
			if (updated.length > 0) {
				await insertReconcilerEvent(db, task.id, "reconciler.probe", {
					exitCode: cmd.exitCode,
					source: "session_command",
				})
				await deleteOtelKeyForTask(ctx, task.id)
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
			const result = await provider.collectResult(sandbox, provider.getArtifactRoot(task.id))
			const success = statusJson.status === "succeeded"
			const nextStatus: TaskStatus = success ? "succeeded" : "failed"
			const sjNow = new Date()
			const updated = await db
				.update(schema.tasks)
				.set({
					status: nextStatus,
					exitCode: statusJson.exitCode ?? (success ? 0 : 1),
					outputSummary: result.summary.slice(0, 2000),
					error: !success
						? (result.stderr || "Task failed with no error output").slice(0, 2000)
						: null,
					completedAt: sjNow,
					heartbeatAt: sjNow,
					updatedAt: sjNow,
					callbackSecretHash: null,
				})
				.where(nonTerminalTaskWhere(task.id))
				.returning({ id: schema.tasks.id })
			if (updated.length > 0) {
				await insertReconcilerEvent(db, task.id, "reconciler.probe", {
					source: "status_json",
					statusJson,
				})
				await deleteOtelKeyForTask(ctx, task.id)
			}
		} else if (
			!trustStatusJson &&
			(statusJson?.status === "succeeded" || statusJson?.status === "failed")
		) {
			await touchProbeTimestamp(db, task.id)
			await insertReconcilerEvent(db, task.id, "reconciler.probe", {
				source: "still_running",
				statusJsonDebug: statusJson,
				note: "status_json_not_authoritative_lastEventSeq_gt_0",
			})
		} else {
			await touchProbeTimestamp(db, task.id)
			await insertReconcilerEvent(db, task.id, "reconciler.probe", { source: "still_running" })
		}
	} catch (e) {
		if (e instanceof DaytonaNotFoundError) {
			// Session is gone — fall back to status.json to determine outcome
			console.warn(
				`[probeSingleTask] session not found for task ${task.id}, falling back to status.json`,
			)
			try {
				const raw = await sandbox.fs.downloadFile(statusJsonPath(task.id)).catch(() => null)
				const statusJson = parseStatusJson(raw?.toString("utf-8") ?? null)

				if (statusJson?.status === "succeeded" || statusJson?.status === "failed") {
					const result = await provider.collectResult(sandbox, provider.getArtifactRoot(task.id))
					const success = statusJson.status === "succeeded"
					const nextStatus: TaskStatus = success ? "succeeded" : "failed"
					const now = new Date()
					const updated = await db
						.update(schema.tasks)
						.set({
							status: nextStatus,
							exitCode: statusJson.exitCode ?? (success ? 0 : 1),
							outputSummary: result.summary.slice(0, 2000),
							error: !success
								? (result.stderr || "Task failed with no error output").slice(0, 2000)
								: null,
							completedAt: now,
							heartbeatAt: now,
							updatedAt: now,
							callbackSecretHash: null,
						})
						.where(nonTerminalTaskWhere(task.id))
						.returning({ id: schema.tasks.id })
					if (updated.length > 0) {
						await insertReconcilerEvent(db, task.id, "reconciler.probe", {
							source: "status_json_after_session_lost",
							statusJson,
						})
						await deleteOtelKeyForTask(ctx, task.id)
					}
				} else {
					// No usable status.json — mark task as lost
					const now = new Date()
					await db
						.update(schema.tasks)
						.set({
							status: "lost",
							error: "Task lost: Daytona session no longer exists and no status.json found",
							completedAt: now,
							updatedAt: now,
						})
						.where(nonTerminalTaskWhere(task.id))
					await insertReconcilerEvent(db, task.id, "task.lost", {
						reason: "session_not_found",
						statusJson: statusJson ?? null,
					})
					await deleteOtelKeyForTask(ctx, task.id)
				}
			} catch (fallbackErr) {
				console.error(`[probeSingleTask] fallback also failed for task ${task.id}:`, fallbackErr)
				const now = new Date()
				await db
					.update(schema.tasks)
					.set({
						status: "lost",
						error: "Task lost: Daytona session gone and fallback probe failed",
						completedAt: now,
						updatedAt: now,
					})
					.where(nonTerminalTaskWhere(task.id))
				await insertReconcilerEvent(db, task.id, "task.lost", {
					reason: "session_not_found_fallback_failed",
				})
				await deleteOtelKeyForTask(ctx, task.id)
			}
		} else {
			// Transient error — log and retry on next cycle
			console.error(`[probeSingleTask] failed for task ${task.id}:`, e)
			await touchProbeTimestamp(db, task.id)
		}
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
		.where(inArray(schema.tasks.status, [...ACTIVE]))

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

	// --- 4) Orphan sweep: clean up OTEL keys for terminal tasks that survived a crash ---
	if (ctx.braintrustHarnessApiKey) {
		const orphaned = await db
			.select({ id: schema.tasks.id })
			.from(schema.tasks)
			.where(and(inArray(schema.tasks.status, TERMINAL_STATUSES), isNotNull(schema.tasks.metadata)))
		for (const row of orphaned) {
			await deleteOtelKeyForTask(ctx, row.id)
		}
	}
}

async function insertReconcilerEvent(
	db: Database,
	taskId: string,
	eventType: string,
	payload: Record<string, unknown>,
) {
	const eventId = crypto.randomUUID()
	const occurredAt = new Date()
	await db.insert(schema.taskEvents).values({
		taskId,
		eventId,
		source: "reconciler",
		eventType,
		seq: null,
		payload,
		occurredAt,
	})
}
