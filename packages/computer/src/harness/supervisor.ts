import type { TaskStatus } from "@amby/db"
import { and, DbService, eq, inArray, schema } from "@amby/db"
import type { Sandbox } from "@daytonaio/sdk"
import { Context, Effect, Layer } from "effect"
import {
	AGENT_WORKDIR,
	CODEX_HOME,
	DEFAULT_TASK_TIMEOUT_SECONDS,
	HEARTBEAT_INTERVAL_MS,
	MAX_ACTIVE_TASKS_PER_USER,
	MAX_HEARTBEAT_FAILURES,
	MAX_WAIT_SECONDS,
	POLL_INTERVAL_MS,
	taskSessionId,
} from "../config"
import { SandboxError } from "../errors"
import { SandboxService } from "../sandbox/service"
import {
	asRecord,
	type CodexAuthCache,
	type CodexAuthSummary,
	clearCodexAuth,
	readHarnessAuthConfig,
	setCodexAuthenticated,
	setCodexInvalid,
	setCodexPendingDeviceAuth,
	summarizeCodexAuth,
} from "./auth-state"
import { CodexInstaller } from "./codex-installer"
import { CodexProvider } from "./codex-provider"

type TaskRecord = typeof schema.tasks.$inferSelect

const TERMINAL_STATUSES: TaskStatus[] = ["succeeded", "failed", "cancelled", "timed_out", "lost"]
const CODEX_AUTH_FILE = `${CODEX_HOME}/auth.json`
const CODEX_AUTH_LOG = `${CODEX_HOME}/login.out`
const CODEX_CONFIG_FILE = `${CODEX_HOME}/config.toml`
const CODEX_CONFIG = 'cli_auth_credentials_store = "file"\n'

// Matches ANSI CSI (ESC[…m) and OSC (ESC]…BEL/ST) sequences.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping requires matching ESC/BEL control chars
const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*(?:\x07|\x1b\\))/g

interface ActiveTask {
	taskId: string
	sandbox: Sandbox
	sessionId: string
	commandId: string
	startedAt: number
	timeoutSeconds: number
	consecutiveFailures: number
}

const stripAnsi = (value: string) => value.replace(ANSI_RE, "")

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const summarizeLoginFailure = (log: string | null, exitCode?: number | null) => {
	const tail = (log ? stripAnsi(log) : "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(-4)
		.join(" ")

	if (tail) return `Codex login failed: ${tail}`
	if (exitCode === 0) return "Codex login finished without writing auth credentials."
	return "Codex login failed. Try again or switch to an API key."
}

const parseDeviceAuthPrompt = (value: string) => {
	const clean = stripAnsi(value)
	const verificationUri = clean.match(/https?:\/\/\S+/)?.[0]
	const userCode = clean.match(/\b[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/)?.[0]
	return verificationUri && userCode ? { verificationUri, userCode } : null
}

/** Decode JWT payload for metadata extraction only — no signature verification. */
const decodeJwtPayload = (jwt?: string) => {
	const payload = jwt?.split(".")[1]
	if (!payload) return null

	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<
			string,
			unknown
		>
	} catch {
		return null
	}
}

const parseCodexAuthFile = (
	value: string,
): { cache: CodexAuthCache; apiKeyLast4?: string } | null => {
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>
		const authMode = typeof parsed.auth_mode === "string" ? parsed.auth_mode : undefined
		const apiKey =
			typeof parsed.OPENAI_API_KEY === "string" ? parsed.OPENAI_API_KEY.trim() : undefined
		const tokens = asRecord(parsed.tokens)
		const accountId = typeof tokens.account_id === "string" ? tokens.account_id : undefined
		const idToken = typeof tokens.id_token === "string" ? tokens.id_token : undefined
		const jwtClaims = asRecord(decodeJwtPayload(idToken))
		const authClaims = asRecord(jwtClaims["https://api.openai.com/auth"])

		if (authMode === "chatgptAuthTokens" || accountId || idToken) {
			return {
				cache: {
					method: "chatgpt",
					accountId,
					workspaceId:
						typeof authClaims.chatgpt_account_id === "string"
							? authClaims.chatgpt_account_id
							: accountId,
					planType:
						typeof authClaims.chatgpt_plan_type === "string"
							? authClaims.chatgpt_plan_type
							: undefined,
					lastRefresh: typeof parsed.last_refresh === "string" ? parsed.last_refresh : undefined,
					updatedAt: new Date().toISOString(),
				},
			}
		}

		if (authMode === "apikey" || authMode === "apiKey" || authMode === "api_key" || apiKey) {
			return {
				cache: {
					method: "api_key",
					updatedAt: new Date().toISOString(),
				},
				apiKeyLast4: apiKey?.slice(-4),
			}
		}

		return null
	} catch {
		return null
	}
}

export class TaskSupervisor extends Context.Tag("TaskSupervisor")<
	TaskSupervisor,
	{
		readonly getCodexAuthStatus: (userId: string) => Effect.Effect<CodexAuthSummary, SandboxError>
		readonly setCodexApiKey: (
			userId: string,
			apiKey: string,
		) => Effect.Effect<CodexAuthSummary, SandboxError>
		readonly startCodexChatgptAuth: (
			userId: string,
		) => Effect.Effect<CodexAuthSummary, SandboxError>
		readonly importCodexChatgptAuth: (
			userId: string,
			authJson: string,
		) => Effect.Effect<CodexAuthSummary, SandboxError>
		readonly clearCodexAuth: (userId: string) => Effect.Effect<CodexAuthSummary, SandboxError>
		readonly startTask: (params: {
			userId: string
			prompt: string
			needsBrowser: boolean
		}) => Effect.Effect<{ taskId: string; status: string }, SandboxError>
		readonly getTask: (
			taskId: string,
			userId: string,
			waitSeconds?: number,
		) => Effect.Effect<TaskRecord | null, SandboxError>
		readonly shutdown: () => Effect.Effect<void>
	}
>() {}

export const TaskSupervisorLive = Layer.scoped(
	TaskSupervisor,
	Effect.gen(function* () {
		const sandboxService = yield* SandboxService
		const { db, query } = yield* DbService

		const installer = new CodexInstaller()
		const provider = new CodexProvider()
		const activeTasks = new Map<string, ActiveTask>()

		const loadSandboxAuthConfig = async (userId: string) => {
			const rows = await db
				.select({ authConfig: schema.sandboxes.authConfig })
				.from(schema.sandboxes)
				.where(eq(schema.sandboxes.userId, userId))
				.limit(1)
			return rows[0]?.authConfig
		}

		const saveSandboxAuthConfig = async (userId: string, authConfig: unknown, sandbox: Sandbox) => {
			const next = readHarnessAuthConfig(authConfig)
			await db
				.update(schema.sandboxes)
				.set({
					authConfig: Object.keys(next).length === 0 ? null : (next as Record<string, unknown>),
					lastActivityAt: new Date(),
				})
				.where(eq(schema.sandboxes.userId, userId))
			return sandbox
		}

		const readSandboxText = async (sandbox: Sandbox, path: string) => {
			try {
				const buf = await sandbox.fs.downloadFile(path)
				return buf.toString("utf-8")
			} catch {
				return null
			}
		}

		const ensureCodexHome = async (sandbox: Sandbox) => {
			await sandbox.process.executeCommand(`mkdir -p ${CODEX_HOME}`)
			await sandbox.fs.uploadFile(Buffer.from(CODEX_CONFIG), CODEX_CONFIG_FILE)
		}

		const deletePendingSession = async (sandbox: Sandbox, sessionId?: string) => {
			if (!sessionId) return
			try {
				await sandbox.process.deleteSession(sessionId)
			} catch {
				// Session may already be gone.
			}
		}

		const syncCodexAuthStatus = async (
			userId: string,
			sandbox: Sandbox,
		): Promise<CodexAuthSummary> => {
			const raw = await loadSandboxAuthConfig(userId)
			const current = readHarnessAuthConfig(raw).codex
			const authJson = await readSandboxText(sandbox, CODEX_AUTH_FILE)
			if (!current && !authJson) return summarizeCodexAuth(null)

			if (authJson) {
				const parsed = parseCodexAuthFile(authJson)
				if (!parsed) {
					const invalid = setCodexInvalid(
						raw,
						"Codex credentials exist in the sandbox, but the cache is invalid. Reconnect Codex.",
					)
					await saveSandboxAuthConfig(userId, invalid, sandbox)
					return summarizeCodexAuth(invalid)
				}

				const authenticated = setCodexAuthenticated(raw, parsed.cache, parsed.apiKeyLast4)
				await saveSandboxAuthConfig(userId, authenticated, sandbox)
				await deletePendingSession(sandbox, current?.pending?.sessionId)
				return summarizeCodexAuth(authenticated)
			}

			if (!current) return summarizeCodexAuth(null)

			if (current.pending) {
				try {
					const cmd = await sandbox.process.getSessionCommand(
						current.pending.sessionId,
						current.pending.commandId,
					)
					if (cmd.exitCode == null) {
						return summarizeCodexAuth(raw)
					}

					const log = await readSandboxText(sandbox, CODEX_AUTH_LOG)
					const invalid = setCodexInvalid(raw, summarizeLoginFailure(log, cmd.exitCode))
					await saveSandboxAuthConfig(userId, invalid, sandbox)
					await deletePendingSession(sandbox, current.pending.sessionId)
					return summarizeCodexAuth(invalid)
				} catch {
					const invalid = setCodexInvalid(
						raw,
						"The Codex login session ended before authentication completed. Start it again.",
					)
					await saveSandboxAuthConfig(userId, invalid, sandbox)
					return summarizeCodexAuth(invalid)
				}
			}

			if (current.preferredMethod) {
				const invalid = setCodexInvalid(
					raw,
					"Stored Codex credentials were not found in the sandbox. Reconnect Codex.",
				)
				await saveSandboxAuthConfig(userId, invalid, sandbox)
				return summarizeCodexAuth(invalid)
			}

			return summarizeCodexAuth(raw)
		}

		const requireCodexAuth = async (userId: string, sandbox: Sandbox) => {
			const auth = await syncCodexAuthStatus(userId, sandbox)
			if (auth.status === "authenticated" && auth.method) {
				return {
					authMode: auth.method === "chatgpt" ? "chatgpt_account" : "api_key",
				} as const
			}

			if (auth.status === "pending" && auth.pending) {
				throw new Error(
					`Codex login is still pending. Open ${auth.pending.verificationUri} and enter ${auth.pending.userCode}.`,
				)
			}

			throw new Error(
				auth.error ??
					"Codex is not configured yet. Connect it with ChatGPT login or an API key first.",
			)
		}

		const heartbeatInterval = setInterval(async () => {
			if (activeTasks.size === 0) return

			for (const task of [...activeTasks.values()]) {
				try {
					await task.sandbox.refreshActivity()
					const cmd = await task.sandbox.process.getSessionCommand(task.sessionId, task.commandId)

					await db
						.update(schema.tasks)
						.set({ heartbeatAt: new Date(), updatedAt: new Date() })
						.where(eq(schema.tasks.id, task.taskId))

					task.consecutiveFailures = 0

					if (cmd.exitCode != null) {
						await finalizeTask(task, cmd.exitCode)
						continue
					}

					const elapsed = (Date.now() - task.startedAt) / 1000
					if (elapsed > task.timeoutSeconds) {
						await timeoutTask(task)
					}
				} catch (err) {
					task.consecutiveFailures += 1
					console.error(
						`[TaskSupervisor] heartbeat failed for ${task.taskId} (${task.consecutiveFailures}/${MAX_HEARTBEAT_FAILURES}):`,
						err,
					)

					if (task.consecutiveFailures >= MAX_HEARTBEAT_FAILURES) {
						await db
							.update(schema.tasks)
							.set({ status: "lost", updatedAt: new Date() })
							.where(eq(schema.tasks.id, task.taskId))
						activeTasks.delete(task.taskId)
					}
				}
			}
		}, HEARTBEAT_INTERVAL_MS)

		async function finalizeTask(task: ActiveTask, exitCode: number) {
			if (!activeTasks.has(task.taskId)) return

			let result = { output: "", summary: "Task completed" }
			try {
				result = await provider.collectResult(task.sandbox, provider.getArtifactRoot(task.taskId))
			} catch {
				// Best effort only.
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

			await deletePendingSession(task.sandbox, task.sessionId)
			activeTasks.delete(task.taskId)
		}

		async function timeoutTask(task: ActiveTask) {
			await deletePendingSession(task.sandbox, task.sessionId)

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

		const recoverRunning = async () => {
			let running: TaskRecord[]
			try {
				running = await db.select().from(schema.tasks).where(eq(schema.tasks.status, "running"))
			} catch (err) {
				console.error("[TaskSupervisor] recovery: failed to query running tasks:", err)
				return
			}

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
						consecutiveFailures: 0,
					})
				} catch {
					await db
						.update(schema.tasks)
						.set({ status: "lost", updatedAt: new Date() })
						.where(eq(schema.tasks.id, task.id))
				}
			}
		}

		// Fire-and-forget: recoverRunning uses Effect.runPromise for sandboxService.ensure
		// because it runs outside the Effect pipeline during layer initialization.
		recoverRunning().catch((err) => console.error("[TaskSupervisor] recovery failed:", err))

		yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(heartbeatInterval)))

		const wrapSandboxError = (cause: unknown) =>
			new SandboxError({
				message: cause instanceof Error ? cause.message : String(cause),
				cause,
			})

		return {
			getCodexAuthStatus: (userId) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)
					return yield* Effect.tryPromise({
						try: () => syncCodexAuthStatus(userId, sandbox),
						catch: wrapSandboxError,
					})
				}),

			setCodexApiKey: (userId, apiKey) =>
				Effect.gen(function* () {
					const trimmed = apiKey.trim()
					if (!trimmed) {
						return yield* Effect.fail(
							new SandboxError({ message: "OpenAI API key cannot be empty." }),
						)
					}

					const sandbox = yield* sandboxService.ensure(userId)
					return yield* Effect.tryPromise({
						try: async () => {
							const raw = await loadSandboxAuthConfig(userId)
							const current = readHarnessAuthConfig(raw).codex

							await ensureCodexHome(sandbox)
							await deletePendingSession(sandbox, current?.pending?.sessionId)
							await sandbox.process.executeCommand(`rm -f ${CODEX_AUTH_LOG}`)

							const authJson = JSON.stringify(
								{ auth_mode: "apikey", OPENAI_API_KEY: trimmed },
								null,
								2,
							)
							await sandbox.fs.uploadFile(Buffer.from(authJson), CODEX_AUTH_FILE)

							const next = setCodexAuthenticated(
								raw,
								{ method: "api_key", updatedAt: new Date().toISOString() },
								trimmed.slice(-4),
							)
							await saveSandboxAuthConfig(userId, next, sandbox)
							return summarizeCodexAuth(next)
						},
						catch: wrapSandboxError,
					})
				}),

			startCodexChatgptAuth: (userId) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)
					const current = yield* Effect.tryPromise({
						try: () => syncCodexAuthStatus(userId, sandbox),
						catch: wrapSandboxError,
					})
					if (current.status === "pending") return current
					if (current.status === "authenticated" && current.method === "chatgpt") return current

					return yield* Effect.tryPromise({
						try: async () => {
							const installResult = await installer.ensureInstalled(sandbox)
							if (!installResult.installed) {
								throw new Error("Failed to install Codex CLI in sandbox.")
							}

							const raw = await loadSandboxAuthConfig(userId)
							const previous = readHarnessAuthConfig(raw).codex

							await ensureCodexHome(sandbox)
							await deletePendingSession(sandbox, previous?.pending?.sessionId)
							await sandbox.process.executeCommand(`rm -f ${CODEX_AUTH_FILE} ${CODEX_AUTH_LOG}`)

							const sessionId = `codex-auth-${Date.now()}`
							const command =
								`cd ${AGENT_WORKDIR} && ` +
								`export CODEX_HOME=${CODEX_HOME} && ` +
								`mkdir -p ${CODEX_HOME} && ` +
								`codex login --device-auth -c 'cli_auth_credentials_store="file"' 2>&1 | tee ${CODEX_AUTH_LOG}`

							await sandbox.process.createSession(sessionId)
							const execResult = await sandbox.process.executeSessionCommand(sessionId, {
								command,
								runAsync: true,
							})

							let pendingPrompt: {
								verificationUri: string
								userCode: string
							} | null = null
							for (let attempt = 0; attempt < 20; attempt++) {
								const log = await readSandboxText(sandbox, CODEX_AUTH_LOG)
								pendingPrompt = log ? parseDeviceAuthPrompt(log) : null
								if (pendingPrompt) break
								await wait(500)
							}

							if (!pendingPrompt) {
								const log = await readSandboxText(sandbox, CODEX_AUTH_LOG)
								await deletePendingSession(sandbox, sessionId)
								throw new Error(summarizeLoginFailure(log))
							}

							const next = setCodexPendingDeviceAuth(raw, {
								type: "device_code",
								verificationUri: pendingPrompt.verificationUri,
								userCode: pendingPrompt.userCode,
								sessionId,
								commandId: execResult.cmdId,
								startedAt: new Date().toISOString(),
							})
							await saveSandboxAuthConfig(userId, next, sandbox)
							return summarizeCodexAuth(next)
						},
						catch: wrapSandboxError,
					})
				}),

			importCodexChatgptAuth: (userId, authJson) =>
				Effect.gen(function* () {
					const parsed = parseCodexAuthFile(authJson)
					if (!parsed || parsed.cache.method !== "chatgpt") {
						return yield* Effect.fail(
							new SandboxError({
								message: "That auth.json does not contain ChatGPT Codex credentials.",
							}),
						)
					}

					const sandbox = yield* sandboxService.ensure(userId)
					return yield* Effect.tryPromise({
						try: async () => {
							const raw = await loadSandboxAuthConfig(userId)
							const current = readHarnessAuthConfig(raw).codex

							await ensureCodexHome(sandbox)
							await deletePendingSession(sandbox, current?.pending?.sessionId)
							await sandbox.process.executeCommand(`rm -f ${CODEX_AUTH_LOG}`)
							await sandbox.fs.uploadFile(
								Buffer.from(JSON.stringify(JSON.parse(authJson), null, 2)),
								CODEX_AUTH_FILE,
							)

							const next = setCodexAuthenticated(raw, parsed.cache)
							await saveSandboxAuthConfig(userId, next, sandbox)
							return summarizeCodexAuth(next)
						},
						catch: wrapSandboxError,
					})
				}),

			clearCodexAuth: (userId) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)
					return yield* Effect.tryPromise({
						try: async () => {
							const raw = await loadSandboxAuthConfig(userId)
							const current = readHarnessAuthConfig(raw).codex
							await deletePendingSession(sandbox, current?.pending?.sessionId)
							await sandbox.process.executeCommand(`rm -f ${CODEX_AUTH_FILE} ${CODEX_AUTH_LOG}`)

							const next = clearCodexAuth(raw)
							await saveSandboxAuthConfig(userId, next, sandbox)
							return summarizeCodexAuth(next)
						},
						catch: wrapSandboxError,
					})
				}),

			startTask: ({ userId, prompt, needsBrowser }) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)

					const { authMode } = yield* Effect.tryPromise({
						try: () => requireCodexAuth(userId, sandbox),
						catch: wrapSandboxError,
					})

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

					// Enforce per-user active task limit
					const activeCount = yield* Effect.tryPromise({
						try: async () => {
							const rows = await db
								.select({ id: schema.tasks.id })
								.from(schema.tasks)
								.where(
									and(
										eq(schema.tasks.userId, userId),
										inArray(schema.tasks.status, ["preparing", "running"]),
									),
								)
							return rows.length
						},
						catch: (error) =>
							new SandboxError({
								message: `Failed to check active tasks: ${error instanceof Error ? error.message : String(error)}`,
								cause: error,
							}),
					})

					if (activeCount >= MAX_ACTIVE_TASKS_PER_USER) {
						return yield* Effect.fail(
							new SandboxError({
								message: `You already have ${activeCount} active tasks. Wait for some to finish before starting another (limit: ${MAX_ACTIVE_TASKS_PER_USER}).`,
							}),
						)
					}

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
							(error) =>
								new SandboxError({
									message: `Failed to create task: ${error instanceof Error ? error.message : String(error)}`,
									cause: error,
								}),
						),
					)

					const taskId = rows[0]?.id
					if (!taskId) {
						return yield* Effect.fail(new SandboxError({ message: "Failed to insert task record" }))
					}

					// Wrap post-insert steps so failures mark the task as failed and clean up
					let sessionId: string | undefined
					const launchResult = yield* Effect.tryPromise({
						try: async () => {
							try {
								const command = await provider.prepareAndBuildCommand(sandbox, {
									taskId,
									prompt,
									authMode,
									needsBrowser,
									timeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
								})

								sessionId = taskSessionId(taskId)
								await sandbox.process.createSession(sessionId)

								const execResult = await sandbox.process.executeSessionCommand(sessionId, {
									command,
									runAsync: true,
								})

								const now = new Date()
								await db
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
									.where(eq(schema.tasks.id, taskId))

								activeTasks.set(taskId, {
									taskId,
									sandbox,
									sessionId,
									commandId: execResult.cmdId,
									startedAt: now.getTime(),
									timeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
									consecutiveFailures: 0,
								})

								return { taskId, status: "running" as const }
							} catch (cause) {
								// Roll back: mark as failed and clean up the session
								await db
									.update(schema.tasks)
									.set({
										status: "failed",
										error: cause instanceof Error ? cause.message : String(cause),
										completedAt: new Date(),
										updatedAt: new Date(),
									})
									.where(eq(schema.tasks.id, taskId))
								await deletePendingSession(sandbox, sessionId)
								throw cause
							}
						},
						catch: (cause) =>
							new SandboxError({
								message: `Task startup failed: ${cause instanceof Error ? cause.message : String(cause)}`,
								cause,
							}),
					})

					return launchResult
				}),

			getTask: (taskId, userId, waitSeconds) =>
				Effect.gen(function* () {
					const cappedWait = waitSeconds ? Math.min(waitSeconds, MAX_WAIT_SECONDS) : 0
					const taskFilter = and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId))

					const fetchTask = async () => {
						const rows = await db.select().from(schema.tasks).where(taskFilter).limit(1)
						return rows[0] ?? null
					}

					let task: TaskRecord | null
					if (cappedWait > 0) {
						task = yield* Effect.tryPromise({
							try: async () => {
								const deadline = Date.now() + cappedWait * 1000
								while (Date.now() < deadline) {
									const t = await fetchTask()
									if (!t) return null
									if (TERMINAL_STATUSES.includes(t.status as TaskStatus)) return t
									await wait(POLL_INTERVAL_MS)
								}
								return await fetchTask()
							},
							catch: (error) =>
								new SandboxError({
									message: `Failed to get task: ${error instanceof Error ? error.message : String(error)}`,
									cause: error,
								}),
						})
					} else {
						task = yield* query((d) =>
							d.select().from(schema.tasks).where(taskFilter).limit(1),
						).pipe(
							Effect.map((rows) => rows[0] ?? null),
							Effect.mapError(
								(error) =>
									new SandboxError({
										message: `Failed to get task: ${error instanceof Error ? error.message : String(error)}`,
										cause: error,
									}),
							),
						)
					}

					// Live session check: if the task is still "running" in DB but not tracked
					// in this supervisor's memory (e.g. supervisor was recreated between workflow
					// steps), check the actual sandbox session to detect completion eagerly.
					if (
						task &&
						task.status === "running" &&
						!activeTasks.has(task.id) &&
						task.sessionId &&
						task.commandId
					) {
						const sandbox = yield* sandboxService
							.ensure(task.userId)
							.pipe(Effect.catchAll(() => Effect.succeed(null as Sandbox | null)))

						if (sandbox) {
							// Capture fields before entering the async closure to avoid non-null assertions
							const taskRef = task
							const sessionId = task.sessionId
							const commandId = task.commandId
							const startedAt = task.startedAt?.getTime() ?? Date.now()
							task = yield* Effect.tryPromise({
								try: async () => {
									const cmd = await sandbox.process.getSessionCommand(sessionId, commandId)
									if (cmd.exitCode != null) {
										await finalizeTask(
											{
												taskId: taskRef.id,
												sandbox,
												sessionId,
												commandId,
												startedAt,
												timeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
												consecutiveFailures: 0,
											},
											cmd.exitCode,
										)
										return await fetchTask()
									}
									// Still running — re-register for heartbeat tracking
									activeTasks.set(taskRef.id, {
										taskId: taskRef.id,
										sandbox,
										sessionId,
										commandId,
										startedAt,
										timeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
										consecutiveFailures: 0,
									})
									return taskRef
								},
								catch: () => new SandboxError({ message: "Live session check failed" }),
							}).pipe(Effect.catchAll(() => Effect.succeed(task)))
						}
					}

					return task
				}),

			shutdown: () =>
				Effect.sync(() => {
					clearInterval(heartbeatInterval)
				}),
		}
	}),
)
