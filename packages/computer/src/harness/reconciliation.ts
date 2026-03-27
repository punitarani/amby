import type {
	AutomationRepository,
	ComputeStoreService,
	TaskRecord,
	TaskStatus,
	TaskStoreService,
	TraceStoreService,
} from "@amby/core"
import type { Sandbox } from "@daytonaio/sdk"
import { Effect } from "effect"
import { STALE_HEARTBEAT_MS, TASK_BASE } from "../config"
import { CodexProvider } from "./codex-provider"
import { parseReplyTarget } from "./reply-target"
import { collectTaskExecutionData } from "./task-execution-data"
import { isTerminal } from "./task-state"
import { isSandboxTask, readSandboxRuntimeData } from "./task-store"
import { appendTaskTraceTerminalEvent } from "./task-trace"

export interface ReconciliationContext {
	taskStore: TaskStoreService
	traceStore: TraceStoreService
	computeStore: ComputeStoreService
	automationRepo?: AutomationRepository
	ensureSandbox: (userId: string) => Promise<Sandbox>
	isDev: boolean
	/** If set, sends templated completion messages for Telegram tasks. */
	sendTelegram?: (chatId: number, text: string) => Promise<void>
	/** If set, computes the next run time for recurring cron automations. */
	computeNextCronRun?: (schedule: string, tz: string) => Date | undefined
}

/** Intentionally module-level: CodexProvider is stateless (no mutable fields). */
const provider = new CodexProvider()

/** Skip probe-driven terminal updates when harness callbacks are still flowing recently. */
function shouldSkipProbeFinalize(task: TaskRecord): boolean {
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

function buildNotificationMessage(task: TaskRecord): string | null {
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
export async function probeSingleTask(ctx: ReconciliationContext, task: TaskRecord): Promise<void> {
	const { taskStore, traceStore, ensureSandbox } = ctx
	if (!isSandboxTask(task)) {
		return
	}
	const sandbox = await ensureSandbox(task.userId)
	const runtimeData = readSandboxRuntimeData(task)

	if (isTerminal(task.status as TaskStatus)) {
		return
	}

	if (!runtimeData?.sessionId || !runtimeData.commandId) {
		const completed = await Effect.runPromise(
			taskStore.completeTask({
				taskId: task.id,
				status: "lost",
				summary: "Task lost because session metadata is missing.",
				payload: { reason: "missing_session" },
			}),
		)
		if (completed) {
			await appendTaskTraceTerminalEvent(traceStore, {
				traceId: task.traceId,
				taskId: task.id,
				status: "lost",
				reason: "missing_session",
			}).catch(() => undefined)
			await Effect.runPromise(
				taskStore
					.appendEvent({
						taskId: task.id,
						source: "maintenance",
						kind: "maintenance.probe",
						payload: { kind: "task.lost", reason: "missing_session" },
					})
					.pipe(Effect.catchAll(() => Effect.void)),
			)
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
				await Effect.runPromise(
					taskStore.touchProbe(task.id).pipe(Effect.catchAll(() => Effect.void)),
				)
				await Effect.runPromise(
					taskStore
						.appendEvent({
							taskId: task.id,
							source: "maintenance",
							kind: "maintenance.probe",
							payload: {
								exitCode: cmd.exitCode,
								source: "session_command",
								skipped: "active_callback_stream",
								lastEventSeq: task.lastEventSeq,
							},
						})
						.pipe(Effect.catchAll(() => Effect.void)),
				)
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
					taskStore.completeTask({
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
					await appendTaskTraceTerminalEvent(traceStore, {
						traceId: task.traceId,
						taskId: task.id,
						status: nextStatus,
						message: result.summary,
						exitCode: cmd.exitCode,
					}).catch(() => undefined)
					await Effect.runPromise(
						taskStore
							.appendEvent({
								taskId: task.id,
								source: "maintenance",
								kind: "maintenance.probe",
								payload: {
									exitCode: cmd.exitCode,
									source: "session_command",
								},
							})
							.pipe(Effect.catchAll(() => Effect.void)),
					)
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
					taskStore.completeTask({
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
					await appendTaskTraceTerminalEvent(traceStore, {
						traceId: task.traceId,
						taskId: task.id,
						status: nextStatus,
						message: result.summary,
						exitCode: statusJson.exitCode ?? (success ? 0 : 1),
					}).catch(() => undefined)
					await Effect.runPromise(
						taskStore
							.appendEvent({
								taskId: task.id,
								source: "maintenance",
								kind: "maintenance.probe",
								payload: {
									source: "status_json",
									statusJson,
								},
							})
							.pipe(Effect.catchAll(() => Effect.void)),
					)
				}
			}
		} else if (
			!trustStatusJson &&
			(statusJson?.status === "succeeded" || statusJson?.status === "failed")
		) {
			await Effect.runPromise(
				taskStore.touchProbe(task.id).pipe(Effect.catchAll(() => Effect.void)),
			)
			await Effect.runPromise(
				taskStore
					.appendEvent({
						taskId: task.id,
						source: "maintenance",
						kind: "maintenance.probe",
						payload: {
							source: "still_running",
							statusJsonDebug: statusJson,
							note: "status_json_not_authoritative_lastEventSeq_gt_0",
						},
					})
					.pipe(Effect.catchAll(() => Effect.void)),
			)
		} else {
			await Effect.runPromise(
				taskStore.touchProbe(task.id).pipe(Effect.catchAll(() => Effect.void)),
			)
			await Effect.runPromise(
				taskStore
					.appendEvent({
						taskId: task.id,
						source: "maintenance",
						kind: "maintenance.probe",
						payload: { source: "still_running" },
					})
					.pipe(Effect.catchAll(() => Effect.void)),
			)
		}
	} catch (e) {
		console.error(`[probeSingleTask] failed for task ${task.id}:`, e)
		await Effect.runPromise(taskStore.touchProbe(task.id).pipe(Effect.catchAll(() => Effect.void)))
	}
}

/**
 * Cron job: sandbox keep-alive, stale task reconciliation, Telegram notifications.
 */
export async function runScheduledReconciliation(ctx: ReconciliationContext): Promise<void> {
	const { taskStore, ensureSandbox, sendTelegram } = ctx

	// --- 1) Keep-alive: refresh activity for each user with active tasks ---
	const userIds = await Effect.runPromise(
		taskStore.findActiveTaskUserIds().pipe(Effect.catchAll(() => Effect.succeed([] as string[]))),
	)

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
	const staleTasks = await Effect.runPromise(
		taskStore
			.findStaleSandboxTasks(staleBefore)
			.pipe(Effect.catchAll(() => Effect.succeed([] as TaskRecord[]))),
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

	const pending = await Effect.runPromise(
		taskStore
			.findPendingNotifications()
			.pipe(Effect.catchAll(() => Effect.succeed([] as TaskRecord[]))),
	)

	for (const task of pending) {
		const target = parseReplyTarget(task.replyTarget)
		if (!target) {
			console.info(
				`[Reconciliation] skip notification for task ${task.id}: unparseable reply_target`,
			)
			continue
		}

		const chatId = target.chatId
		if (!Number.isFinite(chatId)) continue

		const text = buildNotificationMessage(task)
		if (!text) continue

		try {
			await sendTelegram(chatId, text)
			await Effect.runPromise(
				taskStore.markNotified(task.id, task.status).pipe(Effect.catchAll(() => Effect.void)),
			)
		} catch (e) {
			console.error(`[Reconciliation] Telegram notify failed for task ${task.id}:`, e)
		}
	}

	// --- 4) Automation dispatch: fire due automations ---
	await dispatchDueAutomations(ctx)
}

async function dispatchDueAutomations(ctx: ReconciliationContext): Promise<void> {
	const { sendTelegram, computeNextCronRun, automationRepo } = ctx
	if (!sendTelegram || !automationRepo) return

	const now = new Date()
	const dueAutomations = await Effect.runPromise(
		automationRepo.findDue(now).pipe(
			Effect.catchAll(() =>
				Effect.succeed(
					[] as Array<{
						id: string
						kind: string
						payloadJson?: Record<string, unknown> | null
						deliveryTargetJson?: Record<string, unknown> | null
						scheduleJson?: Record<string, unknown> | null
					}>,
				),
			),
		),
	)

	for (const automation of dueAutomations) {
		try {
			const target = parseReplyTarget(automation.deliveryTargetJson)
			if (!target) {
				console.info(`[Reconciliation] skip automation ${automation.id}: no delivery target`)
				continue
			}

			const payload = automation.payloadJson as { description?: string } | null
			const description = payload?.description ?? "Reminder"
			await sendTelegram(target.chatId, `Reminder: ${description}`)

			if (automation.kind === "scheduled") {
				await Effect.runPromise(
					automationRepo
						.updateStatus(automation.id, "completed", { lastRunAt: now, nextRunAt: undefined })
						.pipe(Effect.catchAll(() => Effect.void)),
				)
			} else if (automation.kind === "cron") {
				const schedule = (automation.scheduleJson as { schedule?: string })?.schedule
				const tz = (automation.scheduleJson as { timezone?: string })?.timezone ?? "UTC"
				const nextRunAt =
					schedule && computeNextCronRun ? computeNextCronRun(schedule, tz) : undefined

				if (nextRunAt) {
					await Effect.runPromise(
						automationRepo
							.updateStatus(automation.id, "active", { lastRunAt: now, nextRunAt })
							.pipe(Effect.catchAll(() => Effect.void)),
					)
				} else {
					await Effect.runPromise(
						automationRepo
							.updateStatus(automation.id, "failed", { lastRunAt: now })
							.pipe(Effect.catchAll(() => Effect.void)),
					)
				}
			}
		} catch (e) {
			console.error(`[Reconciliation] automation dispatch failed for ${automation.id}:`, e)
			await Effect.runPromise(
				automationRepo
					.updateStatus(automation.id, "failed")
					.pipe(Effect.catchAll(() => Effect.void)),
			).catch(() => {})
		}
	}
}
