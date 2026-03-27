import { Context, type Effect } from "effect"
import type { TaskStatus } from "../domain/task"
import type { DbError } from "../errors/core-error"

export interface TraceStoreService {
	/**
	 * Append a terminal trace event (delegation_end or error) and
	 * update the parent trace to completed/failed.
	 *
	 * No-ops if traceId is null/undefined.
	 */
	readonly appendTerminalEvent: (params: {
		traceId?: string | null
		taskId: string
		status: TaskStatus
		message?: string | null
		exitCode?: number | null
		reason?: string | null
	}) => Effect.Effect<void, DbError>
}

export class TraceStore extends Context.Tag("TraceStore")<TraceStore, TraceStoreService>() {}
