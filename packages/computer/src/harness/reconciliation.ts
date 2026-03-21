import type { Database } from "@amby/db"
import { eq, inArray, schema } from "@amby/db"
import type { Daytona, Sandbox } from "@daytonaio/sdk"
import { DaytonaNotFoundError, DaytonaRateLimitError } from "@daytonaio/sdk"
import { STALE_HEARTBEAT_MS, sandboxName } from "../config"
import { CodexProvider } from "./codex-provider"

const provider = new CodexProvider()

function isStale(heartbeatAt: Date | null): boolean {
	if (!heartbeatAt) return true
	return Date.now() - heartbeatAt.getTime() > STALE_HEARTBEAT_MS
}

/**
 * Periodic reconciliation: keep sandboxes alive for active tasks, probe stale running tasks.
 */
export async function reconcileTasks(
	db: Database,
	daytona: Daytona,
	isDev: boolean,
): Promise<void> {
	const active = await db
		.select()
		.from(schema.tasks)
		.where(inArray(schema.tasks.status, ["preparing", "running"]))

	if (active.length === 0) return

	const userIds = [...new Set(active.map((t) => t.userId))]
	const sandboxByUser = new Map<string, Sandbox>()

	for (const userId of userIds) {
		try {
			const sb = await daytona.get(sandboxName(userId, isDev))
			await sb.refreshData()
			if (sb.state === "started") {
				await sb.refreshActivity()
				sandboxByUser.set(userId, sb)
			}
		} catch (e) {
			if (e instanceof DaytonaNotFoundError) {
				for (const t of active.filter((x) => x.userId === userId)) {
					await db
						.update(schema.tasks)
						.set({ status: "lost", updatedAt: new Date() })
						.where(eq(schema.tasks.id, t.id))
				}
				continue
			}
			if (e instanceof DaytonaRateLimitError) {
				console.warn("[reconcileTasks] Daytona rate limit — will retry next tick")
				return
			}
			throw e
		}
	}

	for (const task of active) {
		const sandbox = sandboxByUser.get(task.userId)
		if (!sandbox) continue

		if (task.status === "preparing") continue

		if (!isStale(task.heartbeatAt)) continue

		if (!task.sessionId || !task.commandId) continue

		try {
			const cmd = await sandbox.process.getSessionCommand(task.sessionId, task.commandId)
			const now = new Date()

			if (cmd.exitCode != null) {
				let summary = "Task completed"
				try {
					const r = await provider.collectResult(sandbox, provider.getArtifactRoot(task.id))
					summary = r.summary.slice(0, 2000)
				} catch {
					/* best effort */
				}
				await db
					.update(schema.tasks)
					.set({
						status: cmd.exitCode === 0 ? "succeeded" : "failed",
						exitCode: cmd.exitCode,
						outputSummary: summary,
						completedAt: now,
						updatedAt: now,
						lastProbeAt: now,
						heartbeatAt: now,
						callbackTokenExpiresAt: now,
					})
					.where(eq(schema.tasks.id, task.id))
				try {
					await sandbox.process.deleteSession(task.sessionId)
				} catch {
					/* ignore */
				}
				continue
			}

			const statusJson = await readStatusJson(sandbox, task.artifactRoot)
			if (statusJson?.status === "succeeded" || statusJson?.status === "failed") {
				let summary = "Task completed"
				try {
					const r = await provider.collectResult(sandbox, provider.getArtifactRoot(task.id))
					summary = r.summary.slice(0, 2000)
				} catch {
					/* best effort */
				}
				await db
					.update(schema.tasks)
					.set({
						status: statusJson.status === "succeeded" ? "succeeded" : "failed",
						exitCode: statusJson.exitCode ?? (statusJson.status === "succeeded" ? 0 : 1),
						outputSummary: summary,
						completedAt: now,
						updatedAt: now,
						lastProbeAt: now,
						heartbeatAt: now,
						callbackTokenExpiresAt: now,
					})
					.where(eq(schema.tasks.id, task.id))
				try {
					await sandbox.process.deleteSession(task.sessionId)
				} catch {
					/* ignore */
				}
				continue
			}

			await db
				.update(schema.tasks)
				.set({ lastProbeAt: now, updatedAt: now, heartbeatAt: now })
				.where(eq(schema.tasks.id, task.id))
		} catch (e) {
			if (e instanceof DaytonaRateLimitError) {
				console.warn("[reconcileTasks] rate limit during probe — stopping batch")
				return
			}
			console.error(`[reconcileTasks] probe failed for task ${task.id}:`, e)
		}
	}
}

async function readStatusJson(
	sandbox: Sandbox,
	artifactRoot: string | null,
): Promise<{ status?: string; exitCode?: number | null } | null> {
	if (!artifactRoot) return null
	try {
		const buf = await sandbox.fs.downloadFile(`${artifactRoot}/status.json`)
		const parsed = JSON.parse(buf.toString("utf-8")) as {
			status?: string
			exitCode?: number | null
		}
		return parsed
	} catch {
		return null
	}
}

export async function probeTaskForUser(
	db: Database,
	daytona: Daytona,
	userId: string,
	taskId: string,
	isDev: boolean,
): Promise<typeof schema.tasks.$inferSelect | null> {
	const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1)
	if (!task || task.userId !== userId) return null

	let sandbox: Sandbox
	try {
		sandbox = await daytona.get(sandboxName(userId, isDev))
	} catch {
		return task
	}

	await sandbox.refreshData()
	if (sandbox.state !== "started") return task

	if (task.status !== "running" || !task.sessionId || !task.commandId) return task

	try {
		const cmd = await sandbox.process.getSessionCommand(task.sessionId, task.commandId)
		const now = new Date()
		if (cmd.exitCode != null) {
			let summary = "Task completed"
			try {
				const r = await provider.collectResult(sandbox, provider.getArtifactRoot(task.id))
				summary = r.summary.slice(0, 2000)
			} catch {
				/* best effort */
			}
			await db
				.update(schema.tasks)
				.set({
					status: cmd.exitCode === 0 ? "succeeded" : "failed",
					exitCode: cmd.exitCode,
					outputSummary: summary,
					completedAt: now,
					updatedAt: now,
					lastProbeAt: now,
					callbackTokenExpiresAt: now,
				})
				.where(eq(schema.tasks.id, taskId))
			try {
				await sandbox.process.deleteSession(task.sessionId)
			} catch {
				/* ignore */
			}
		} else {
			await db
				.update(schema.tasks)
				.set({ lastProbeAt: now, updatedAt: now })
				.where(eq(schema.tasks.id, taskId))
		}
	} catch {
		/* ignore */
	}

	const [updated] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1)
	return updated ?? task
}
