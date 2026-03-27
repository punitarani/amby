import { Context, type Effect } from "effect"
import type { RunnerKind, SpecialistKind } from "../domain/execution"
import type {
	TaskEventKind,
	TaskEventSource,
	TaskProvider,
	TaskRuntime,
	TaskStatus,
} from "../domain/task"
import type { DbError } from "../errors/core-error"

// ---- Record shapes (match DB row, not domain model — intentional) ----

export interface TaskRecord {
	readonly id: string
	readonly userId: string
	readonly runtime: TaskRuntime
	readonly provider: TaskProvider
	readonly status: TaskStatus
	readonly threadId?: string | null
	readonly traceId?: string | null
	readonly parentTaskId?: string | null
	readonly rootTaskId?: string | null
	readonly specialist?: SpecialistKind | null
	readonly runnerKind?: RunnerKind | null
	readonly input?: unknown
	readonly output?: unknown
	readonly artifacts?: unknown
	readonly confirmationState?: "not_required" | "required" | "confirmed" | "rejected" | null
	readonly prompt: string
	readonly requiresBrowser: boolean
	readonly runtimeData?: Record<string, unknown> | null
	readonly outputSummary?: string | null
	readonly error?: string | null
	readonly exitCode?: number | null
	readonly startedAt?: Date | null
	readonly heartbeatAt?: Date | null
	readonly completedAt?: Date | null
	readonly createdAt: Date
	readonly updatedAt: Date
	readonly metadata?: Record<string, unknown> | null
	readonly conversationId?: string | null
	readonly replyTarget?: Record<string, unknown> | null
	readonly callbackId?: string | null
	readonly callbackSecretHash?: string | null
	readonly lastEventSeq: number
	readonly lastEventAt?: Date | null
	readonly lastProbeAt?: Date | null
	readonly notifiedStatus?: string | null
	readonly lastNotificationAt?: Date | null
}

export interface TaskRecordInsert {
	readonly id?: string
	readonly userId: string
	readonly runtime: TaskRuntime
	readonly provider: TaskProvider
	readonly status?: TaskStatus
	readonly threadId?: string | null
	readonly traceId?: string | null
	readonly parentTaskId?: string | null
	readonly rootTaskId?: string | null
	readonly specialist?: SpecialistKind | null
	readonly runnerKind?: RunnerKind | null
	readonly input?: unknown
	readonly output?: unknown
	readonly artifacts?: unknown
	readonly confirmationState?: "not_required" | "required" | "confirmed" | "rejected" | null
	readonly prompt: string
	readonly requiresBrowser?: boolean
	readonly runtimeData?: Record<string, unknown> | null
	readonly outputSummary?: string | null
	readonly error?: string | null
	readonly exitCode?: number | null
	readonly startedAt?: Date | null
	readonly heartbeatAt?: Date | null
	readonly completedAt?: Date | null
	readonly metadata?: Record<string, unknown> | null
	readonly conversationId?: string | null
	readonly replyTarget?: Record<string, unknown> | null
	readonly callbackId?: string | null
	readonly callbackSecretHash?: string | null
	readonly lastEventSeq?: number
	readonly lastEventAt?: Date | null
}

export type TaskRecordUpdate = Partial<TaskRecordInsert>

export interface TaskEventRecord {
	readonly id: string
	readonly taskId: string
	readonly eventId: string
	readonly source: TaskEventSource
	readonly kind: TaskEventKind
	readonly seq?: number | null
	readonly payload?: Record<string, unknown> | null
	readonly occurredAt: Date
	readonly createdAt: Date
}

export type TaskTerminalStatus =
	| "succeeded"
	| "partial"
	| "escalated"
	| "failed"
	| "timed_out"
	| "lost"

export type TaskProgressKind = "task.started" | "task.progress" | "task.heartbeat"

// ---- Port interface ----

export interface TaskStoreService {
	/** Insert a task row + a task.created event inside a transaction. */
	readonly createTask: (
		params: TaskRecordInsert & { eventPayload?: Record<string, unknown> },
	) => Effect.Effect<void, DbError>

	/** Partial update on a task row. */
	readonly updateTask: (taskId: string, patch: TaskRecordUpdate) => Effect.Effect<void, DbError>

	/** Append a standalone task event. */
	readonly appendEvent: (params: {
		taskId: string
		eventId?: string
		source: TaskEventSource
		kind: TaskEventKind
		seq?: number | null
		payload?: Record<string, unknown>
		occurredAt?: Date
	}) => Effect.Effect<void, DbError>

	/**
	 * Idempotent progress update: bump task seq + insert event in a transaction.
	 * Returns true when the update was applied (seq was newer), false otherwise.
	 */
	readonly appendProgressEvent: (params: {
		taskId: string
		source?: Extract<TaskEventSource, "runtime" | "backend">
		kind?: TaskProgressKind
		seq: number
		payload?: Record<string, unknown>
		occurredAt?: Date
		status?: TaskStatus
	}) => Effect.Effect<boolean, DbError>

	/**
	 * Mark a task as terminal + insert the terminal event in a transaction.
	 * Returns true when the update was applied, false when already terminal.
	 */
	readonly completeTask: (params: {
		taskId: string
		status: TaskTerminalStatus
		output?: unknown
		artifacts?: unknown
		summary: string
		error?: string | null
		exitCode?: number | null
		runtimeData?: Record<string, unknown> | null
		payload?: Record<string, unknown>
	}) => Effect.Effect<boolean, DbError>

	/** Get recent task events, ordered by occurredAt desc. */
	readonly listRecentEvents: (
		taskId: string,
		limit: number,
	) => Effect.Effect<TaskEventRecord[], DbError>

	/** Get a single task by id. */
	readonly getById: (taskId: string) => Effect.Effect<TaskRecord | null, DbError>

	/** Get a single task by id + userId. */
	readonly getByIdAndUser: (
		taskId: string,
		userId: string,
	) => Effect.Effect<TaskRecord | null, DbError>

	/** Update heartbeatAt + updatedAt. */
	readonly heartbeat: (taskId: string) => Effect.Effect<void, DbError>

	/** Update lastProbeAt + updatedAt. */
	readonly touchProbe: (taskId: string) => Effect.Effect<void, DbError>

	/** Mark task as notified with the given status. */
	readonly markNotified: (taskId: string, status: string) => Effect.Effect<void, DbError>

	/** Count active sandbox tasks for a user. */
	readonly countActiveSandboxTasks: (userId: string) => Effect.Effect<number, DbError>

	/** Find running sandbox tasks. */
	readonly findRunningSandboxTasks: () => Effect.Effect<TaskRecord[], DbError>

	/** Find stale preparing sandbox tasks older than the given cutoff. */
	readonly findStalePreparingSandboxTasks: (
		cutoff: Date,
	) => Effect.Effect<Array<{ id: string; traceId: string | null }>, DbError>

	/** Find distinct user IDs with active sandbox tasks. */
	readonly findActiveTaskUserIds: () => Effect.Effect<string[], DbError>

	/** Find stale sandbox tasks (heartbeat older than given time or null). */
	readonly findStaleSandboxTasks: (staleBefore: Date) => Effect.Effect<TaskRecord[], DbError>

	/** Find terminal tasks that need notification. */
	readonly findPendingNotifications: () => Effect.Effect<TaskRecord[], DbError>

	/** Lookup conversation platform by ID. */
	readonly getConversationPlatform: (
		conversationId: string,
	) => Effect.Effect<string | null, DbError>

	/** Lookup Telegram chat id for a user. */
	readonly getTelegramChatId: (userId: string) => Effect.Effect<number | null, DbError>
}

export class TaskStore extends Context.Tag("TaskStore")<TaskStore, TaskStoreService>() {}
