import type {
	RunnerKind,
	TaskEventKind,
	TaskProvider,
	TaskRecord,
	TaskRuntime,
	TaskTerminalStatus,
} from "@amby/core"

export type { TaskRecord, TaskTerminalStatus }
export type TaskProgressKind = "task.started" | "task.progress" | "task.heartbeat"

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export function mergeRuntimeData(
	current: unknown,
	patch: Record<string, unknown>,
): Record<string, unknown> | null {
	const merged = Object.fromEntries(
		Object.entries({
			...asRecord(current),
			...patch,
		}).filter(([, value]) => value !== undefined),
	)
	return Object.keys(merged).length > 0 ? merged : null
}

export function isSandboxTask(task: Pick<TaskRecord, "runtime" | "provider">): boolean {
	return task.runtime === "sandbox" && task.provider === "codex"
}

export function readTaskRuntimeData(
	task: Pick<TaskRecord, "runtimeData">,
): Record<string, unknown> {
	return asRecord(task.runtimeData)
}

export function readSandboxRuntimeData(task: Pick<TaskRecord, "runtime" | "runtimeData">): {
	authMode?: "api_key" | "chatgpt_account"
	sandboxId?: string
	sessionId?: string
	commandId?: string
	artifactRoot?: string
} | null {
	if (task.runtime !== "sandbox") return null
	const runtimeData = readTaskRuntimeData(task)
	return {
		authMode:
			runtimeData.authMode === "api_key" || runtimeData.authMode === "chatgpt_account"
				? runtimeData.authMode
				: undefined,
		sandboxId: typeof runtimeData.sandboxId === "string" ? runtimeData.sandboxId : undefined,
		sessionId: typeof runtimeData.sessionId === "string" ? runtimeData.sessionId : undefined,
		commandId: typeof runtimeData.commandId === "string" ? runtimeData.commandId : undefined,
		artifactRoot:
			typeof runtimeData.artifactRoot === "string" ? runtimeData.artifactRoot : undefined,
	}
}

export function deriveRuntimeForRunner(params: {
	runnerKind?: RunnerKind
	requiresBrowser?: boolean
}): {
	runtime: TaskRuntime
	provider: TaskProvider
	requiresBrowser: boolean
} {
	switch (params.runnerKind) {
		case "browser_service":
			return {
				runtime: "browser",
				provider: "stagehand",
				requiresBrowser: true,
			}
		case "background_handoff":
			return {
				runtime: "sandbox",
				provider: "codex",
				requiresBrowser: Boolean(params.requiresBrowser),
			}
		default:
			return {
				runtime: "in_process",
				provider: "internal",
				requiresBrowser: false,
			}
	}
}

export function mapExecutionResultStatus(
	status: "completed" | "partial" | "failed" | "escalate",
): TaskTerminalStatus {
	switch (status) {
		case "completed":
			return "succeeded"
		case "partial":
			return "partial"
		case "escalate":
			return "escalated"
		case "failed":
			return "failed"
	}
}

export function taskEventKindForTerminalStatus(status: TaskTerminalStatus): TaskEventKind {
	switch (status) {
		case "succeeded":
			return "task.completed"
		case "partial":
			return "task.partial"
		case "escalated":
			return "task.escalated"
		case "failed":
			return "task.failed"
		case "timed_out":
			return "task.timed_out"
		case "lost":
			return "task.lost"
	}
}
