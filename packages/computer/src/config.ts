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
export const HEARTBEAT_INTERVAL_MS = 60_000
export const POLL_INTERVAL_MS = 2_000
export const MAX_WAIT_SECONDS = 15

// ── CUA ────────────────────────────────────────────────────────────────

export const CUA_STALE_MINUTES = 15

// ── Naming patterns ────────────────────────────────────────────────────

export const sandboxName = (userId: string, isDev: boolean) =>
	`computer-v1-${userId}${isDev ? "-dev" : ""}`

export const sandboxLabels = (userId: string, isDev: boolean) => ({
	userId,
	app: "amby",
	environment: isDev ? "dev" : "production",
})

export const taskSessionId = (taskId: string) => `task-${taskId}`
