import type { TaskStatus } from "@amby/db"
import { DbService, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { getValidAccessToken } from "@amby/models"
import type { Sandbox } from "@daytonaio/sdk"
import { Context, Effect, Layer } from "effect"
import {
	DEFAULT_TASK_TIMEOUT_SECONDS,
	HEARTBEAT_INTERVAL_MS,
	MAX_WAIT_SECONDS,
	POLL_INTERVAL_MS,
	taskSessionId,
} from "../config"
import { SandboxError } from "../errors"
import { SandboxService } from "../sandbox/service"
import { CodexInstaller } from "./codex-installer"
import { CodexProvider } from "./codex-provider"

type TaskRecord = typeof schema.tasks.$inferSelect

const TERMINAL_STATUSES: TaskStatus[] = ["succeeded", "failed", "cancelled", "timed_out", "lost"]

interface ActiveTask {
	taskId: string
	sandbox: Sandbox
	sessionId: string
	commandId: string
	startedAt: number
	timeoutSeconds: number
}

export class TaskSupervisor extends Context.Tag("TaskSupervisor")<
	TaskSupervisor,
	{
		readonly startTask: (params: {
			userId: string
			prompt: string
			needsBrowser: boolean
		}) => Effect.Effect<{ taskId: string; status: string }, SandboxError>

		readonly getTask: (
			taskId: string,
			waitSeconds?: number,
		) => Effect.Effect<TaskRecord | null, SandboxError>

		readonly shutdown: () => Effect.Effect<void>
	}
>() {}

export const TaskSupervisorLive = Layer.effect(
	TaskSupervisor,
	Effect.gen(function* () {
		const sandboxService = yield* SandboxService
		const { db, query } = yield* DbService
		const env = yield* EnvService

		const installer = new CodexInstaller()
		const provider = new CodexProvider()
		const activeTasks = new Map<string, ActiveTask>()

		async function resolveAuth(): Promise<{
			apiKey: string
			authMode: "api_key" | "chatgpt_account"
		}> {
			// Try OAuth first
			const oauthToken = await getValidAccessToken()
			if (oauthToken) {
				return { apiKey: oauthToken, authMode: "chatgpt_account" }
			}

			// Fall back to API key
			if (env.OPENAI_API_KEY) {
				return { apiKey: env.OPENAI_API_KEY, authMode: "api_key" }
			}

			throw new Error(
				"No OpenAI authentication available. Either authenticate with `amby auth openai` or set the OPENAI_API_KEY environment variable.",
			)
		}

		// Heartbeat loop
		const heartbeatInterval = setInterval(async () => {
			for (const task of [...activeTasks.values()]) {
				try {
					// Refresh sandbox activity to prevent auto-stop
					await task.sandbox.refreshActivity()

					// Check command status
					const cmd = await task.sandbox.process.getSessionCommand(task.sessionId, task.commandId)

					// Update heartbeat
					await db
						.update(schema.tasks)
						.set({ heartbeatAt: new Date(), updatedAt: new Date() })
						.where(eq(schema.tasks.id, task.taskId))

					// Command completed
					if (cmd.exitCode != null) {
						await finalizeTask(task, cmd.exitCode)
						continue
					}

					// Check timeout
					const elapsed = (Date.now() - task.startedAt) / 1000
					if (elapsed > task.timeoutSeconds) {
						await timeoutTask(task)
					}
				} catch {
					// If we can't reach the sandbox, mark as lost
					await db
						.update(schema.tasks)
						.set({ status: "lost", updatedAt: new Date() })
						.where(eq(schema.tasks.id, task.taskId))
					activeTasks.delete(task.taskId)
				}
			}
		}, HEARTBEAT_INTERVAL_MS)

		async function finalizeTask(task: ActiveTask, exitCode: number) {
			let result = { output: "", summary: "Task completed" }
			try {
				const artifactRoot = provider.getArtifactRoot(task.taskId)
				result = await provider.collectResult(task.sandbox, artifactRoot)
			} catch {
				// If we can't collect results, use defaults
			}

			await db
				.update(schema.tasks)
				.set({
					status: exitCode === 0 ? "succeeded" : "failed",
					outputSummary: result.summary.slice(0, 2000),
					exitCode,
					completedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(schema.tasks.id, task.taskId))

			try {
				await task.sandbox.process.deleteSession(task.sessionId)
			} catch {
				// Session may already be gone
			}

			activeTasks.delete(task.taskId)
		}

		async function timeoutTask(task: ActiveTask) {
			try {
				await task.sandbox.process.deleteSession(task.sessionId)
			} catch {
				// Session may already be gone
			}

			await db
				.update(schema.tasks)
				.set({
					status: "timed_out",
					completedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(schema.tasks.id, task.taskId))

			activeTasks.delete(task.taskId)
		}

		// Recovery: reconnect to running tasks from a previous supervisor lifecycle
		const recoverRunning = async () => {
			const running = await db.select().from(schema.tasks).where(eq(schema.tasks.status, "running"))

			for (const task of running) {
				if (!task.sandboxId || !task.sessionId || !task.commandId) {
					await db
						.update(schema.tasks)
						.set({ status: "lost", updatedAt: new Date() })
						.where(eq(schema.tasks.id, task.id))
					continue
				}

				try {
					const sandbox = await Effect.runPromise(sandboxService.ensure(task.userId))
					await sandbox.process.getSession(task.sessionId)

					activeTasks.set(task.id, {
						taskId: task.id,
						sandbox,
						sessionId: task.sessionId,
						commandId: task.commandId,
						startedAt: task.startedAt?.getTime() ?? Date.now(),
						timeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
					})
				} catch {
					await db
						.update(schema.tasks)
						.set({ status: "lost", updatedAt: new Date() })
						.where(eq(schema.tasks.id, task.id))
				}
			}
		}

		// Run recovery (non-blocking — errors are caught inside)
		recoverRunning().catch(() => {})

		return {
			startTask: ({ userId, prompt, needsBrowser }) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)

					// Resolve auth (OAuth first, then API key fallback)
					const { apiKey, authMode } = yield* Effect.tryPromise({
						try: () => resolveAuth(),
						catch: (cause) =>
							new SandboxError({
								message: cause instanceof Error ? cause.message : String(cause),
								cause,
							}),
					})

					// Ensure codex is installed
					const installResult = yield* Effect.tryPromise({
						try: () => installer.ensureInstalled(sandbox),
						catch: (cause) =>
							new SandboxError({
								message: `Failed to install Codex: ${cause instanceof Error ? cause.message : String(cause)}`,
								cause,
							}),
					})

					if (!installResult.installed) {
						return yield* Effect.fail(
							new SandboxError({ message: "Failed to install Codex CLI in sandbox" }),
						)
					}

					// Insert task record
					const rows = yield* query((d) =>
						d
							.insert(schema.tasks)
							.values({
								userId,
								provider: "codex",
								authMode,
								status: "preparing",
								prompt,
								needsBrowser: needsBrowser ? "true" : "false",
								sandboxId: sandbox.id,
							})
							.returning({ id: schema.tasks.id }),
					).pipe(
						Effect.mapError(
							(e) =>
								new SandboxError({
									message: `Failed to create task: ${e instanceof Error ? e.message : String(e)}`,
									cause: e,
								}),
						),
					)

					const taskId = rows[0]?.id
					if (!taskId) {
						return yield* Effect.fail(new SandboxError({ message: "Failed to insert task record" }))
					}

					// Prepare workspace and build command
					const command = yield* Effect.tryPromise({
						try: () =>
							provider.prepareAndBuildCommand(sandbox, {
								taskId,
								prompt,
								apiKey,
								authMode,
								needsBrowser,
								timeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
							}),
						catch: (cause) =>
							new SandboxError({
								message: `Failed to prepare task workspace: ${cause instanceof Error ? cause.message : String(cause)}`,
								cause,
							}),
					})

					// Create session and execute async
					const sessionId = taskSessionId(taskId)

					yield* Effect.tryPromise({
						try: () => sandbox.process.createSession(sessionId),
						catch: (cause) =>
							new SandboxError({
								message: `Failed to create session: ${cause instanceof Error ? cause.message : String(cause)}`,
								cause,
							}),
					})

					const execResult = yield* Effect.tryPromise({
						try: () =>
							sandbox.process.executeSessionCommand(sessionId, {
								command,
								runAsync: true,
							}),
						catch: (cause) =>
							new SandboxError({
								message: `Failed to execute command: ${cause instanceof Error ? cause.message : String(cause)}`,
								cause,
							}),
					})

					const now = new Date()
					yield* query((d) =>
						d
							.update(schema.tasks)
							.set({
								status: "running",
								artifactRoot: provider.getArtifactRoot(taskId),
								sessionId,
								commandId: execResult.cmdId,
								startedAt: now,
								heartbeatAt: now,
								updatedAt: now,
							})
							.where(eq(schema.tasks.id, taskId)),
					).pipe(
						Effect.mapError(
							(e) =>
								new SandboxError({
									message: `Failed to update task status: ${e instanceof Error ? e.message : String(e)}`,
									cause: e,
								}),
						),
					)

					activeTasks.set(taskId, {
						taskId,
						sandbox,
						sessionId,
						commandId: execResult.cmdId,
						startedAt: now.getTime(),
						timeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
					})

					return { taskId, status: "running" }
				}),

			getTask: (taskId, waitSeconds) =>
				Effect.gen(function* () {
					const cappedWait = waitSeconds ? Math.min(waitSeconds, MAX_WAIT_SECONDS) : 0

					if (cappedWait > 0) {
						// Short poll: check at intervals until terminal or deadline
						const result = yield* Effect.tryPromise({
							try: async () => {
								const deadline = Date.now() + cappedWait * 1000
								while (Date.now() < deadline) {
									const rows = await db
										.select()
										.from(schema.tasks)
										.where(eq(schema.tasks.id, taskId))
										.limit(1)
									const task = rows[0]
									if (!task) return null
									if (TERMINAL_STATUSES.includes(task.status as TaskStatus)) {
										return task
									}
									await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
								}
								// Deadline reached — return current state
								const rows = await db
									.select()
									.from(schema.tasks)
									.where(eq(schema.tasks.id, taskId))
									.limit(1)
								return rows[0] ?? null
							},
							catch: (e) =>
								new SandboxError({
									message: `Failed to get task: ${e instanceof Error ? e.message : String(e)}`,
									cause: e,
								}),
						})
						return result
					}

					// Immediate check (no wait)
					return yield* query((d) =>
						d.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1),
					).pipe(
						Effect.map((rows) => rows[0] ?? null),
						Effect.mapError(
							(e) =>
								new SandboxError({
									message: `Failed to get task: ${e instanceof Error ? e.message : String(e)}`,
									cause: e,
								}),
						),
					)
				}),

			shutdown: () =>
				Effect.sync(() => {
					clearInterval(heartbeatInterval)
				}),
		}
	}),
)
