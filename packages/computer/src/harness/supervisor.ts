import { getTelegramChatId } from "@amby/connectors"
import type { RunnerKind, SpecialistKind, TaskStatus } from "@amby/db"
import { and, DbService, eq, inArray, lte, notInArray, schema } from "@amby/db"
import { EnvService } from "@amby/env"
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
	PREPARING_TIMEOUT_MS,
	taskSessionId,
} from "../config"
import { SandboxError, sandboxErrorFromDefect } from "../errors"
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
import { mintCallbackSecret } from "./callback"
import { CodexInstaller } from "./codex-installer"
import { CodexProvider } from "./codex-provider"
import { probeSingleTask } from "./reconciliation"
import { collectTaskExecutionData, previewTaskOutput } from "./task-execution-data"
import { isTerminal, TERMINAL_STATUSES } from "./task-state"

type TaskRecord = typeof schema.tasks.$inferSelect
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
	/** When set, lifecycle events arrive via callbacks; skip Daytona polling in heartbeat. */
	hasCallbacks: boolean
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
			taskId?: string
			userId: string
			prompt: string
			needsBrowser?: boolean
			conversationId?: string
			threadId?: string
			traceId?: string
			parentTaskId?: string
			rootTaskId?: string
			specialist?: SpecialistKind
			runnerKind?: RunnerKind
			input?: Record<string, unknown>
			metadata?: Record<string, unknown>
			confirmationState?: "not_required" | "required" | "confirmed" | "rejected"
		}) => Effect.Effect<{ taskId: string; status: string }, SandboxError>
		readonly probeTask: (
			taskId: string,
			userId: string,
		) => Effect.Effect<TaskRecord | null, SandboxError>
		readonly getTaskArtifacts: (
			taskId: string,
			userId: string,
		) => Effect.Effect<
			{ files: { name: string; size: number }[]; resultPreview?: string } | null,
			SandboxError
		>
		readonly getTask: (
			taskId: string,
			userId: string,
			waitSeconds?: number,
		) => Effect.Effect<TaskRecord | null, SandboxError>
		readonly getTaskExecutionData: (
			taskId: string,
			userId: string,
		) => Effect.Effect<
			{ output: string; summary: string; artifacts: Array<Record<string, unknown>> } | null,
			SandboxError
		>
		readonly shutdown: () => Effect.Effect<void>
	}
>() {}

export const TaskSupervisorLive = Layer.scoped(
	TaskSupervisor,
	Effect.gen(function* () {
		const sandboxService = yield* SandboxService
		const env = yield* EnvService
		const { db, query } = yield* DbService

		const installer = new CodexInstaller()
		const provider = new CodexProvider()
		const activeTasks = new Map<string, ActiveTask>()

		const loadAuthConfig = async (userId: string) => {
			const rows = await db
				.select({ authConfig: schema.userVolumes.authConfig })
				.from(schema.userVolumes)
				.where(eq(schema.userVolumes.userId, userId))
				.limit(1)
			return rows[0]?.authConfig
		}

		const saveAuthConfig = async (userId: string, authConfig: unknown) => {
			const next = readHarnessAuthConfig(authConfig)
			await db
				.update(schema.userVolumes)
				.set({
					authConfig: Object.keys(next).length === 0 ? null : (next as Record<string, unknown>),
					updatedAt: new Date(),
				})
				.where(eq(schema.userVolumes.userId, userId))
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
			const raw = await loadAuthConfig(userId)
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
					await saveAuthConfig(userId, invalid)
					return summarizeCodexAuth(invalid)
				}

				const authenticated = setCodexAuthenticated(raw, parsed.cache, parsed.apiKeyLast4)
				await saveAuthConfig(userId, authenticated)
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
					await saveAuthConfig(userId, invalid)
					await deletePendingSession(sandbox, current.pending.sessionId)
					return summarizeCodexAuth(invalid)
				} catch {
					const invalid = setCodexInvalid(
						raw,
						"The Codex login session ended before authentication completed. Start it again.",
					)
					await saveAuthConfig(userId, invalid)
					return summarizeCodexAuth(invalid)
				}
			}

			if (current.preferredMethod) {
				const invalid = setCodexInvalid(
					raw,
					"Stored Codex credentials were not found in the sandbox. Reconnect Codex.",
				)
				await saveAuthConfig(userId, invalid)
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

					if (task.hasCallbacks) {
						const elapsed = (Date.now() - task.startedAt) / 1000
						if (elapsed > task.timeoutSeconds) {
							await timeoutTask(task)
						}
						continue
					}

					const cmd = await task.sandbox.process.getSessionCommand(task.sessionId, task.commandId)

					const hbNow = new Date()
					await db
						.update(schema.tasks)
						.set({ heartbeatAt: hbNow, updatedAt: hbNow })
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
							.where(
								and(
									eq(schema.tasks.id, task.taskId),
									notInArray(schema.tasks.status, TERMINAL_STATUSES),
								),
							)
						activeTasks.delete(task.taskId)
					}
				}
			}
		}, HEARTBEAT_INTERVAL_MS)

		async function finalizeTask(task: ActiveTask, exitCode: number) {
			if (!activeTasks.has(task.taskId)) return

			const rows = await db
				.select({ status: schema.tasks.status })
				.from(schema.tasks)
				.where(eq(schema.tasks.id, task.taskId))
				.limit(1)
			const current = rows[0]?.status as TaskStatus | undefined
			if (current && isTerminal(current)) {
				await deletePendingSession(task.sandbox, task.sessionId)
				activeTasks.delete(task.taskId)
				return
			}

			let result = {
				output: "",
				summary: "Task completed",
				artifacts: [] as Array<Record<string, unknown>>,
			}
			try {
				const executionData = await collectTaskExecutionData({
					sandbox: task.sandbox,
					provider,
					taskId: task.taskId,
					artifactRoot: provider.getArtifactRoot(task.taskId),
				})
				result = {
					output: executionData.output,
					summary: executionData.summary,
					artifacts: executionData.artifacts,
				}
			} catch {
				// Best effort only.
			}

			await db
				.update(schema.tasks)
				.set({
					status: exitCode === 0 ? "succeeded" : "failed",
					outputSummary: result.summary.slice(0, 2000),
					output: result.output ? { result: result.output } : null,
					artifacts: result.artifacts,
					exitCode,
					completedAt: new Date(),
					updatedAt: new Date(),
					callbackSecretHash: null,
				})
				.where(
					and(eq(schema.tasks.id, task.taskId), notInArray(schema.tasks.status, TERMINAL_STATUSES)),
				)

			await deletePendingSession(task.sandbox, task.sessionId)
			activeTasks.delete(task.taskId)
		}

		async function timeoutTask(task: ActiveTask) {
			await deletePendingSession(task.sandbox, task.sessionId)

			const toNow = new Date()
			await db
				.update(schema.tasks)
				.set({
					status: "timed_out",
					completedAt: toNow,
					updatedAt: toNow,
				})
				.where(
					and(eq(schema.tasks.id, task.taskId), notInArray(schema.tasks.status, TERMINAL_STATUSES)),
				)

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

			const preparingStaleBefore = new Date(Date.now() - PREPARING_TIMEOUT_MS)
			try {
				const lpNow = new Date()
				const lostPreparing = await db
					.update(schema.tasks)
					.set({
						status: "lost",
						error: "Task did not start in time.",
						completedAt: lpNow,
						updatedAt: lpNow,
					})
					.where(
						and(
							eq(schema.tasks.status, "preparing"),
							lte(schema.tasks.createdAt, preparingStaleBefore),
						),
					)
					.returning({ id: schema.tasks.id })
				for (const row of lostPreparing) {
					const eventId = crypto.randomUUID()
					try {
						await db.insert(schema.taskEvents).values({
							taskId: row.id,
							eventId,
							source: "server",
							kind: "task.lost",
							seq: null,
							payload: { reason: "preparing_timeout" },
							occurredAt: new Date(),
						})
					} catch (e) {
						console.error(`[TaskSupervisor] recovery: failed to insert task.lost for ${row.id}:`, e)
					}
				}
			} catch (e) {
				console.error("[TaskSupervisor] recovery: failed to mark stale preparing tasks:", e)
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
						hasCallbacks: Boolean(task.callbackSecretHash),
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

		return {
			getCodexAuthStatus: (userId) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)
					return yield* Effect.tryPromise({
						try: () => syncCodexAuthStatus(userId, sandbox),
						catch: sandboxErrorFromDefect,
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
							const raw = await loadAuthConfig(userId)
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
							await saveAuthConfig(userId, next)
							return summarizeCodexAuth(next)
						},
						catch: sandboxErrorFromDefect,
					})
				}),

			startCodexChatgptAuth: (userId) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)
					const current = yield* Effect.tryPromise({
						try: () => syncCodexAuthStatus(userId, sandbox),
						catch: sandboxErrorFromDefect,
					})
					if (current.status === "pending") return current
					if (current.status === "authenticated" && current.method === "chatgpt") return current

					return yield* Effect.tryPromise({
						try: async () => {
							const installResult = await installer.ensureInstalled(sandbox)
							if (!installResult.installed) {
								throw new Error("Failed to install Codex CLI in sandbox.")
							}

							const raw = await loadAuthConfig(userId)
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
							await saveAuthConfig(userId, next)
							return summarizeCodexAuth(next)
						},
						catch: sandboxErrorFromDefect,
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
							const raw = await loadAuthConfig(userId)
							const current = readHarnessAuthConfig(raw).codex

							await ensureCodexHome(sandbox)
							await deletePendingSession(sandbox, current?.pending?.sessionId)
							await sandbox.process.executeCommand(`rm -f ${CODEX_AUTH_LOG}`)
							await sandbox.fs.uploadFile(
								Buffer.from(JSON.stringify(JSON.parse(authJson), null, 2)),
								CODEX_AUTH_FILE,
							)

							const next = setCodexAuthenticated(raw, parsed.cache)
							await saveAuthConfig(userId, next)
							return summarizeCodexAuth(next)
						},
						catch: sandboxErrorFromDefect,
					})
				}),

			clearCodexAuth: (userId) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)
					return yield* Effect.tryPromise({
						try: async () => {
							const raw = await loadAuthConfig(userId)
							const current = readHarnessAuthConfig(raw).codex
							await deletePendingSession(sandbox, current?.pending?.sessionId)
							await sandbox.process.executeCommand(`rm -f ${CODEX_AUTH_FILE} ${CODEX_AUTH_LOG}`)

							const next = clearCodexAuth(raw)
							await saveAuthConfig(userId, next)
							return summarizeCodexAuth(next)
						},
						catch: sandboxErrorFromDefect,
					})
				}),

			startTask: ({
				taskId: providedTaskId,
				userId,
				prompt,
				needsBrowser,
				conversationId,
				threadId,
				traceId,
				parentTaskId,
				rootTaskId,
				specialist,
				runnerKind,
				input,
				metadata,
				confirmationState,
			}) =>
				Effect.gen(function* () {
					const sandbox = yield* sandboxService.ensure(userId)

					const { authMode } = yield* Effect.tryPromise({
						try: () => requireCodexAuth(userId, sandbox),
						catch: sandboxErrorFromDefect,
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

					const creds = yield* Effect.tryPromise({
						try: () => mintCallbackSecret(),
						catch: (cause) =>
							new SandboxError({
								message: `Failed to mint callback credentials: ${cause instanceof Error ? cause.message : String(cause)}`,
								cause,
							}),
					})

					const taskId = providedTaskId ?? crypto.randomUUID()
					const callbackId = crypto.randomUUID()
					const apiBase = env.API_URL.replace(/\/$/, "")
					const callbackUrl = `${apiBase}/internal/task-events`

					let channelType: string | undefined
					let replyTarget: Record<string, unknown> | undefined

					if (conversationId) {
						const convRows = yield* query((d) =>
							d
								.select({ platform: schema.conversations.platform })
								.from(schema.conversations)
								.where(eq(schema.conversations.id, conversationId))
								.limit(1),
						).pipe(
							Effect.mapError(
								(error) =>
									new SandboxError({
										message: `Failed to load conversation: ${error instanceof Error ? error.message : String(error)}`,
										cause: error,
									}),
							),
						)
						channelType = convRows[0]?.platform
						if (channelType === "telegram") {
							const accRows = yield* query((d) =>
								d
									.select({ metadata: schema.accounts.metadata })
									.from(schema.accounts)
									.where(
										and(
											eq(schema.accounts.userId, userId),
											eq(schema.accounts.providerId, "telegram"),
										),
									)
									.limit(1),
							).pipe(
								Effect.mapError(
									(error) =>
										new SandboxError({
											message: `Failed to load Telegram account: ${error instanceof Error ? error.message : String(error)}`,
											cause: error,
										}),
								),
							)
							const chatId = getTelegramChatId(accRows[0]?.metadata)
							if (chatId !== undefined) replyTarget = { channel: "telegram" as const, chatId }
						}
					}

					const rows = yield* query((d) =>
						d
							.insert(schema.tasks)
							.values({
								id: taskId,
								userId,
								provider: "codex",
								authMode,
								status: "preparing",
								threadId,
								traceId,
								parentTaskId,
								rootTaskId: rootTaskId ?? taskId,
								specialist,
								runnerKind,
								input,
								confirmationState,
								prompt,
								needsBrowser: needsBrowser ? "true" : "false",
								sandboxId: sandbox.id,
								conversationId,
								channelType,
								replyTarget,
								callbackId,
								callbackSecretHash: creds.hash,
								lastEventSeq: 0,
								metadata,
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

					const insertedTaskId = rows[0]?.id
					if (!insertedTaskId) {
						return yield* Effect.fail(new SandboxError({ message: "Failed to insert task record" }))
					}

					const createdEventId = crypto.randomUUID()
					yield* query((d) =>
						d.insert(schema.taskEvents).values({
							taskId: insertedTaskId,
							eventId: createdEventId,
							source: "server",
							kind: "task.created",
							seq: null,
							payload: {
								conversationId: conversationId ?? null,
								threadId: threadId ?? null,
								traceId: traceId ?? null,
								parentTaskId: parentTaskId ?? null,
								rootTaskId: rootTaskId ?? taskId,
							},
							occurredAt: new Date(),
						}),
					).pipe(
						Effect.mapError(
							(error) =>
								new SandboxError({
									message: `Failed to record task.created: ${error instanceof Error ? error.message : String(error)}`,
									cause: error,
								}),
						),
					)

					// Wrap post-insert steps so failures mark the task as failed and clean up
					let sessionId: string | undefined
					const launchResult = yield* Effect.tryPromise({
						try: async () => {
							try {
								const command = await provider.prepareAndBuildCommand(sandbox, {
									taskId: insertedTaskId,
									prompt,
									authMode,
									needsBrowser: needsBrowser ?? false,
									timeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
									conversationId: conversationId,
									callbackUrl,
									callbackId,
									callbackSecret: creds.raw,
								})

								sessionId = taskSessionId(insertedTaskId)
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
										artifactRoot: provider.getArtifactRoot(insertedTaskId),
										sessionId,
										commandId: execResult.cmdId,
										startedAt: now,
										heartbeatAt: now,
										updatedAt: now,
									})
									.where(eq(schema.tasks.id, insertedTaskId))

								activeTasks.set(insertedTaskId, {
									taskId: insertedTaskId,
									sandbox,
									sessionId,
									commandId: execResult.cmdId,
									startedAt: now.getTime(),
									timeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
									consecutiveFailures: 0,
									hasCallbacks: true,
								})

								return { taskId: insertedTaskId, status: "running" as const }
							} catch (cause) {
								// Roll back: mark as failed and clean up the session
								const failNow = new Date()
								await db
									.update(schema.tasks)
									.set({
										status: "failed",
										error: cause instanceof Error ? cause.message : String(cause),
										completedAt: failNow,
										updatedAt: failNow,
									})
									.where(eq(schema.tasks.id, insertedTaskId))
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
									if (isTerminal(t.status as TaskStatus)) return t
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
												hasCallbacks: Boolean(taskRef.callbackSecretHash),
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
										hasCallbacks: Boolean(taskRef.callbackSecretHash),
									})
									return taskRef
								},
								catch: () => new SandboxError({ message: "Live session check failed" }),
							}).pipe(Effect.catchAll(() => Effect.succeed(task)))
						}
					}

					return task
				}),

			probeTask: (taskId, userId) =>
				Effect.gen(function* () {
					const taskRows = yield* query((d) =>
						d
							.select()
							.from(schema.tasks)
							.where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)))
							.limit(1),
					).pipe(
						Effect.mapError(
							(error) =>
								new SandboxError({
									message: `probe_task: ${error instanceof Error ? error.message : String(error)}`,
									cause: error,
								}),
						),
					)
					const task = taskRows[0]
					if (!task) return null
					const sandbox = yield* sandboxService.ensure(userId)
					yield* Effect.tryPromise({
						try: () =>
							probeSingleTask(
								{
									db,
									ensureSandbox: async (uid) => {
										if (uid !== userId) throw new Error("User mismatch")
										return sandbox
									},
									isDev: env.NODE_ENV !== "production",
								},
								task,
							),
						catch: sandboxErrorFromDefect,
					})
					const updated = yield* query((d) =>
						d.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1),
					).pipe(
						Effect.mapError(
							(error) =>
								new SandboxError({
									message: `probe_task reload: ${error instanceof Error ? error.message : String(error)}`,
									cause: error,
								}),
						),
					)
					return updated[0] ?? null
				}),

			getTaskArtifacts: (taskId, userId) =>
				Effect.gen(function* () {
					const executionData = yield* Effect.tryPromise({
						try: async () => {
							const taskRows = await db
								.select()
								.from(schema.tasks)
								.where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)))
								.limit(1)
							const task = taskRows[0]
							if (!task) return null

							const sandbox = await Effect.runPromise(sandboxService.ensure(userId))
							return await collectTaskExecutionData({
								sandbox,
								provider,
								taskId,
								artifactRoot: task.artifactRoot ?? provider.getArtifactRoot(taskId),
							})
						},
						catch: (error) =>
							new SandboxError({
								message: `get_task_artifacts: ${error instanceof Error ? error.message : String(error)}`,
								cause: error,
							}),
					})
					if (!executionData) return null
					return {
						files: executionData.files,
						resultPreview: previewTaskOutput(executionData.output),
					}
				}),

			getTaskExecutionData: (taskId, userId) =>
				Effect.tryPromise({
					try: async () => {
						const taskRows = await db
							.select()
							.from(schema.tasks)
							.where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)))
							.limit(1)
						const task = taskRows[0]
						if (!task) return null

						const sandbox = await Effect.runPromise(sandboxService.ensure(userId))
						const executionData = await collectTaskExecutionData({
							sandbox,
							provider,
							taskId,
							artifactRoot: task.artifactRoot ?? provider.getArtifactRoot(taskId),
						})
						return {
							output: executionData.output,
							summary: executionData.summary,
							artifacts: executionData.artifacts,
						}
					},
					catch: sandboxErrorFromDefect,
				}),

			shutdown: () =>
				Effect.sync(() => {
					clearInterval(heartbeatInterval)
				}),
		}
	}),
)
