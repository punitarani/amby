import type { Daytona, Sandbox } from "@daytonaio/sdk"
import { DaytonaError, DaytonaNotFoundError } from "@daytonaio/sdk"
import {
	AGENT_USER,
	AUTO_ARCHIVE_MINUTES,
	AUTO_STOP_MINUTES,
	COMPUTER_SNAPSHOT,
	SANDBOX_RESOURCES,
	SANDBOX_START_TIMEOUT,
	sandboxLabels,
	sandboxName,
} from "../config"

export type SandboxDbStatus =
	| "volume_creating"
	| "creating"
	| "running"
	| "stopped"
	| "archived"
	| "error"
	| "deleted"

/** Snapshot-based spec passed to `daytona.create` — shared by SandboxService and provision workflow */
export function buildSandboxCreateParams(userId: string, isDev: boolean) {
	return {
		name: sandboxName(userId, isDev),
		snapshot: COMPUTER_SNAPSHOT,
		resources: SANDBOX_RESOURCES,
		autoStopInterval: AUTO_STOP_MINUTES,
		autoArchiveInterval: AUTO_ARCHIVE_MINUTES,
		labels: sandboxLabels(userId, isDev),
		user: AGENT_USER,
	}
}

const DEFAULT_SANDBOX_READY_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_SANDBOX_POLL_INTERVAL_MS = 1_000

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function isDuplicateSandboxNameError(cause: unknown): boolean {
	const msg = cause instanceof Error ? cause.message : String(cause)
	return /already exists/i.test(msg)
}

/** Map Daytona sandbox state to our DB status column */
export function inferDbStatusFromSandbox(sandbox: Sandbox): SandboxDbStatus {
	const s = sandbox.state
	if (s === "archived" || s === "archiving") return "archived"
	if (s === "stopped" || s === "stopping") return "stopped"
	if (s === "error" || s === "build_failed") return "error"
	return "running"
}

/**
 * Returns the sandbox if it exists in Daytona, otherwise null (404 only — other errors propagate).
 */
export async function tryGetSandboxByName(daytona: Daytona, name: string): Promise<Sandbox | null> {
	try {
		return await daytona.get(name)
	} catch (cause) {
		if (cause instanceof DaytonaNotFoundError) return null
		if (cause instanceof DaytonaError && cause.statusCode === 404) return null
		throw cause
	}
}

export async function startSandboxIfNeeded(sandbox: Sandbox): Promise<void> {
	await sandbox.refreshData()
	if (sandbox.state === "started") return
	await sandbox.start(SANDBOX_START_TIMEOUT)
}

export async function waitForSandboxStarted(
	sandbox: Sandbox,
	options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<Sandbox> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_SANDBOX_READY_TIMEOUT_MS
	const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_SANDBOX_POLL_INTERVAL_MS
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		await sandbox.refreshData()

		if (sandbox.state === "started") return sandbox

		if (sandbox.state === "stopped" || sandbox.state === "archived") {
			await sandbox.start(SANDBOX_START_TIMEOUT)
			await wait(pollIntervalMs)
			continue
		}

		if (sandbox.state === "error" || sandbox.state === "build_failed") {
			throw new Error(`Sandbox entered ${sandbox.state} while waiting to start.`)
		}

		await wait(pollIntervalMs)
	}

	throw new Error(`Timed out waiting for sandbox ${sandbox.id} to reach started state.`)
}
