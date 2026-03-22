/** Centralized sandbox & harness configuration constants */

// ── Paths ──────────────────────────────────────────────────────────────

export const AGENT_HOME = "/home/agent"
export const AGENT_WORKDIR = `${AGENT_HOME}/workspace`
export const TASK_BASE = `${AGENT_WORKDIR}/tasks`
export const CODEX_HOME = `${AGENT_HOME}/.codex`
export const MANIFEST_PATH = "/.amby/harnesses.json"
export const CUA_LOCK_PATH = "/tmp/amby-cua.lock"

// ── Users ──────────────────────────────────────────────────────────────

export const AGENT_USER = "agent"

// ── Sandbox lifecycle ──────────────────────────────────────────────────

export const AUTO_STOP_MINUTES = 15
export const AUTO_ARCHIVE_MINUTES = 60
export const SANDBOX_RESOURCES = { cpu: 2, memory: 4, disk: 5 } as const

// ── Sandbox operation timeouts (seconds) ───────────────────────────────

export const SANDBOX_START_TIMEOUT = 60
export const SANDBOX_CREATE_TIMEOUT = 300
export const COMMAND_EXEC_TIMEOUT = 30
export const NPM_INSTALL_TIMEOUT = 120

// ── Task supervisor ────────────────────────────────────────────────────

export const DEFAULT_TASK_TIMEOUT_SECONDS = 300
/** Stale `preparing` tasks older than this are marked `lost` (slow cold start tolerance). */
export const PREPARING_TIMEOUT_MS = 10 * 60 * 1000
export const HEARTBEAT_INTERVAL_MS = 60_000
export const POLL_INTERVAL_MS = 2_000
export const MAX_WAIT_SECONDS = 15
export const MAX_ACTIVE_TASKS_PER_USER = 5
export const MAX_HEARTBEAT_FAILURES = 3
/** Treat harness heartbeats older than this as stale for reconciliation (ms). */
export const STALE_HEARTBEAT_MS = 3 * 60 * 1000
/** Harness heartbeat interval sent to callback response (ms). */
export const CALLBACK_HEARTBEAT_INTERVAL_MS = 30_000

// ── Codex auth URLs ───────────────────────────────────────────────────

export const CODEX_DEVICE_AUTH_SETTINGS_URL = "https://chatgpt.com/#settings/Security"
export const CODEX_DEVICE_AUTH_URL = "https://auth.openai.com/codex/device"

// ── CUA ────────────────────────────────────────────────────────────────

export const CUA_STALE_MINUTES = 15

// ── Volume ─────────────────────────────────────────────────────────────

export const VOLUME_MOUNT_PATH = AGENT_HOME
export const volumeName = (userId: string, isDev: boolean) =>
	`amby-vol-${userId}${isDev ? "-dev" : ""}`

// ── Naming patterns ────────────────────────────────────────────────────

export const sandboxName = (userId: string, isDev: boolean) =>
	`computer-v1-${userId}${isDev ? "-dev" : ""}`

export const sandboxLabels = (userId: string, isDev: boolean) => ({
	userId,
	app: "amby",
	environment: isDev ? "dev" : "production",
})

export const taskSessionId = (taskId: string) => `task-${taskId}`
