import type { RunnerKind, SpecialistKind } from "./execution"

export type TaskStatus =
	| "pending"
	| "awaiting_auth"
	| "preparing"
	| "running"
	| "succeeded"
	| "partial"
	| "escalated"
	| "failed"
	| "cancelled"
	| "timed_out"
	| "lost"

export type TaskRuntime = "in_process" | "browser" | "sandbox"
export type TaskProvider = "internal" | "stagehand" | "codex"

export type TaskEventSource = "server" | "runtime" | "backend" | "maintenance"
export type TaskEventKind =
	| "task.created"
	| "task.started"
	| "task.progress"
	| "task.heartbeat"
	| "task.completed"
	| "task.partial"
	| "task.escalated"
	| "task.failed"
	| "task.timed_out"
	| "task.lost"
	| "task.notification_sent"
	| "backend.notify"
	| "maintenance.probe"

export interface Task {
	readonly id: string
	readonly runId?: string
	readonly userId: string
	readonly threadId?: string
	readonly pluginId?: string
	readonly runnerKind?: RunnerKind
	readonly specialist?: SpecialistKind
	readonly provider: TaskProvider
	readonly runtime: TaskRuntime
	readonly status: TaskStatus
	readonly inputJson?: unknown
	readonly outputJson?: unknown
	readonly artifactsJson?: unknown
	readonly runtimeJson?: Record<string, unknown>
	readonly summary?: string
	readonly error?: string
	readonly startedAt?: Date
	readonly heartbeatAt?: Date
	readonly completedAt?: Date
	readonly createdAt: Date
	readonly updatedAt: Date
}

export interface TaskEvent {
	readonly id: string
	readonly taskId: string
	readonly eventId: string
	readonly source: TaskEventSource
	readonly kind: TaskEventKind
	readonly seq?: number
	readonly payload?: Record<string, unknown>
	readonly occurredAt: Date
	readonly createdAt: Date
}
