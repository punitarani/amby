/** Centralized sandbox & harness configuration constants */

// ── Paths ──────────────────────────────────────────────────────────────

export const AGENT_HOME = "/home/agent"

// Hidden mount root for the persistent volume. User-facing paths are symlinked into it.
export const VOLUME_MOUNT_PATH = `${AGENT_HOME}/.persist`

// Standard Mac-like user directories (all persisted via symlinks into the volume)
export const DESKTOP_DIR = `${AGENT_HOME}/Desktop`
export const DOCUMENTS_DIR = `${AGENT_HOME}/Documents`
export const DOWNLOADS_DIR = `${AGENT_HOME}/Downloads`
export const VOLUME_DESKTOP_DIR = `${VOLUME_MOUNT_PATH}/Desktop`
export const VOLUME_DOCUMENTS_DIR = `${VOLUME_MOUNT_PATH}/Documents`
export const VOLUME_DOWNLOADS_DIR = `${VOLUME_MOUNT_PATH}/Downloads`

/** Default working directory — keep this outside the mounted volume so first boot always works. */
export const AGENT_WORKDIR = AGENT_HOME

/** Internal task working dirs — hidden to keep Desktop clean and persisted via symlink. */
export const TASK_BASE = `${AGENT_HOME}/.tasks`
export const VOLUME_TASK_BASE = `${VOLUME_MOUNT_PATH}/.tasks`

export const CODEX_HOME = `${AGENT_HOME}/.codex`
export const VOLUME_CODEX_HOME = `${VOLUME_MOUNT_PATH}/.codex`
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
