import type { Daytona, Sandbox } from "@daytonaio/sdk"
import { DaytonaError, DaytonaNotFoundError } from "@daytonaio/sdk"
import {
	AGENT_USER,
	AUTO_ARCHIVE_MINUTES,
	AUTO_STOP_MINUTES,
	SANDBOX_RESOURCES,
	SANDBOX_START_TIMEOUT,
	sandboxLabels,
	sandboxName,
} from "../config"
import { sandboxImage as defaultSandboxImage } from "./sandbox-image"

export type SandboxDbStatus = "creating" | "running" | "stopped" | "archived" | "error"

/** Spec passed to `daytona.create` — shared by SandboxService and provision workflow */
export function buildSandboxCreateParams(
	userId: string,
	isDev: boolean,
	image: typeof defaultSandboxImage = defaultSandboxImage,
) {
	const name = sandboxName(userId, isDev)
	return {
		name,
		image,
		resources: SANDBOX_RESOURCES,
		autoStopInterval: AUTO_STOP_MINUTES,
		autoArchiveInterval: AUTO_ARCHIVE_MINUTES,
		labels: sandboxLabels(userId, isDev),
		user: AGENT_USER,
	}
}

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
