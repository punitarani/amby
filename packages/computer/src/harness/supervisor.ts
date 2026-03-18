import type { TaskStatus } from "@amby/db"
import { DbService, eq, schema } from "@amby/db"
import type { Sandbox } from "@daytonaio/sdk"
import { Context, Effect, Layer } from "effect"
import {
	AGENT_WORKDIR,
	CODEX_HOME,
	DEFAULT_TASK_TIMEOUT_SECONDS,
	HEARTBEAT_INTERVAL_MS,
	MAX_WAIT_SECONDS,
	POLL_INTERVAL_MS,
	taskSessionId,
} from "../config"
import { SandboxError } from "../errors"
import { SandboxService } from "../sandbox/service"
import {
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

interface ActiveTask {
	taskId: string
	sandbox: Sandbox
	sessionId: string
	commandId: string
	startedAt: number
	timeoutSeconds: number
}

const asRecord = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

const stripAnsi = (value: string) => {
	let clean = ""

	for (let i = 0; i < value.length; i += 1) {
		if (value[i] === "\u001b" && value[i + 1] === "[") {
			i += 2

			while (i < value.length && value[i] !== "m") {
				i += 1
			}

			continue
		}

		clean += value[i]
	}

	return clean
}

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

		const saveSandboxAuthConfig = async (
			userId: string,
			authConfig: unknown,
			sandbox?: Sandbox,
		) => {
			const next = readHarnessAuthConfig(authConfig)
			const instance = sandbox ?? (await Effect.runPromise(sandboxService.ensure(userId)))
			await db
				.update(schema.sandboxes)
				.set({
					authConfig: Object.keys(next).length === 0 ? null : (next as Record<string, unknown>),
					lastActivityAt: new Date(),
				})
				.where(eq(schema.sandboxes.userId, userId))
			return instance
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
			sandbox?: Sandbox,
		): Promise<CodexAuthSummary> => {
			const raw = await loadSandboxAuthConfig(userId)
			const current = readHarnessAuthConfig(raw).codex
			const instance = sandbox ?? (await Effect.runPromise(sandboxService.ensure(userId)))
			const authJson = await readSandboxText(instance, CODEX_AUTH_FILE)
			if (!current && !authJson) return summarizeCodexAuth(null)

			if (authJson) {
				const parsed = parseCodexAuthFile(authJson)
				if (!parsed) {
					const invalid = setCodexInvalid(
						raw,
						"Codex credentials exist in the sandbox, but the cache is invalid. Reconnect Codex.",
					)
					await saveSandboxAuthConfig(userId, invalid, instance)
					return summarizeCodexAuth(invalid)
				}

				const authenticated = setCodexAuthenticated(raw, parsed.cache, parsed.apiKeyLast4)
				await saveSandboxAuthConfig(userId, authenticated, instance)
				await deletePendingSession(instance, current?.pending?.sessionId)
				return summarizeCodexAuth(authenticated)
			}

			if (!current) return summarizeCodexAuth(null)

			if (current.pending) {
				try {
					const cmd = await instance.process.getSessionCommand(
						current.pending.sessionId,
						current.pending.commandId,
					)
					if (cmd.exitCode == null) {
						return summarizeCodexAuth(raw)
					}

					const log = await readSandboxText(instance, CODEX_AUTH_LOG)
					const invalid = setCodexInvalid(raw, summarizeLoginFailure(log, cmd.exitCode))
					await saveSandboxAuthConfig(userId, invalid, instance)
					await deletePendingSession(instance, current.pending.sessionId)
					return summarizeCodexAuth(invalid)
				} catch {
					const invalid = setCodexInvalid(
						raw,
						"The Codex login session ended before authentication completed. Start it again.",
					)
					await saveSandboxAuthConfig(userId, invalid, instance)
					return summarizeCodexAuth(invalid)
				}
			}

			if (current.preferredMethod) {
				const invalid = setCodexInvalid(
					raw,
					"Stored Codex credentials were not found in the sandbox. Reconnect Codex.",
				)
				await saveSandboxAuthConfig(userId, invalid, instance)
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
			for (const task of [...activeTasks.values()]) {
				try {
					await task.sandbox.refreshActivity()
					const cmd = await task.sandbox.process.getSessionCommand(task.sessionId, task.commandId)

					await db
						.update(schema.tasks)
						.set({ heartbeatAt: new Date(), updatedAt: new Date() })
						.where(eq(schema.tasks.id, task.taskId))

					if (cmd.exitCode != null) {
						await finalizeTask(task, cmd.exitCode)
						continue
					}

					const elapsed = (Date.now() - task.startedAt) / 1000
					if (elapsed > task.timeoutSeconds) {
						await timeoutTask(task)
					}
				} catch {
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

		recoverRunning().catch(() => {})

		return {
			getCodexAuthStatus: (userId) =>
				Effect.tryPromise({
					try: () => syncCodexAuthStatus(userId),
					catch: (cause) =>
						new SandboxError({
							message: `Failed to inspect Codex auth: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				}),

			setCodexApiKey: (userId, apiKey) =>
				Effect.tryPromise({
					try: async () => {
						const trimmed = apiKey.trim()
						if (!trimmed) {
							throw new Error("OpenAI API key cannot be empty.")
						}

						const sandbox = await Effect.runPromise(sandboxService.ensure(userId))
						const raw = await loadSandboxAuthConfig(userId)
						const current = readHarnessAuthConfig(raw).codex

						await ensureCodexHome(sandbox)
						await deletePendingSession(sandbox, current?.pending?.sessionId)
						await sandbox.process.executeCommand(`rm -f ${CODEX_AUTH_LOG}`)

						const authJson = JSON.stringify(
							{
								auth_mode: "apikey",
								OPENAI_API_KEY: trimmed,
							},
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
					catch: (cause) =>
						new SandboxError({
							message: `Failed to save Codex API key: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				}),

			startCodexChatgptAuth: (userId) =>
				Effect.tryPromise({
					try: async () => {
						const sandbox = await Effect.runPromise(sandboxService.ensure(userId))
						const current = await syncCodexAuthStatus(userId, sandbox)
						if (current.status === "pending") return current
						if (current.status === "authenticated" && current.method === "chatgpt") return current

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

						let pendingPrompt: { verificationUri: string; userCode: string } | null = null
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
					catch: (cause) =>
						new SandboxError({
							message: `Failed to start Codex ChatGPT login: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				}),

			importCodexChatgptAuth: (userId, authJson) =>
				Effect.tryPromise({
					try: async () => {
						const parsed = parseCodexAuthFile(authJson)
						if (!parsed || parsed.cache.method !== "chatgpt") {
							throw new Error("That auth.json does not contain ChatGPT Codex credentials.")
						}

						const sandbox = await Effect.runPromise(sandboxService.ensure(userId))
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
					catch: (cause) =>
						new SandboxError({
							message: `Failed to import Codex auth.json: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				}),

			clearCodexAuth: (userId) =>
				Effect.tryPromise({
					try: async () => {
						const raw = await loadSandboxAuthConfig(userId)
						const sandbox = await Effect.runPromise(sandboxService.ensure(userId))
						const current = readHarnessAuthConfig(raw).codex
						await deletePendingSession(sandbox, current?.pending?.sessionId)
						await sandbox.process.executeCommand(`rm -f ${CODEX_AUTH_FILE} ${CODEX_AUTH_LOG}`)

						const next = clearCodexAuth(raw)
						await saveSandboxAuthConfig(userId, next, sandbox)
						return summarizeCodexAuth(next)
					},
					catch: (cause) =>
						new SandboxError({
							message: `Failed to clear Codex auth: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				}),

			startTask: ({ userId, prompt, needsBrowser }) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)

					const { authMode } = yield* Effect.tryPromise({
						try: () => requireCodexAuth(userId, sandbox),
						catch: (cause) =>
							new SandboxError({
								message: cause instanceof Error ? cause.message : String(cause),
								cause,
							}),
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

					const command = yield* Effect.tryPromise({
						try: () =>
							provider.prepareAndBuildCommand(sandbox, {
								taskId,
								prompt,
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
							(error) =>
								new SandboxError({
									message: `Failed to update task status: ${error instanceof Error ? error.message : String(error)}`,
									cause: error,
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
									await wait(POLL_INTERVAL_MS)
								}
								const rows = await db
									.select()
									.from(schema.tasks)
									.where(eq(schema.tasks.id, taskId))
									.limit(1)
								return rows[0] ?? null
							},
							catch: (error) =>
								new SandboxError({
									message: `Failed to get task: ${error instanceof Error ? error.message : String(error)}`,
									cause: error,
								}),
						})
						return result
					}

					return yield* query((d) =>
						d.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1),
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
				}),

			shutdown: () =>
				Effect.sync(() => {
					clearInterval(heartbeatInterval)
				}),
		}
	}),
)
