import type { TaskStatus, TraceStoreService } from "@amby/core"
import { Effect } from "effect"

/**
 * Append a terminal trace event using the TraceStore service.
 * Returns a promise that never rejects — errors are silently swallowed
 * because trace writes are best-effort in the task lifecycle.
 */
export async function appendTaskTraceTerminalEvent(
	traceStore: TraceStoreService,
	params: {
		traceId?: string | null
		taskId: string
		status: TaskStatus
		message?: string | null
		exitCode?: number | null
		reason?: string | null
	},
): Promise<void> {
	if (!params.traceId) return

	await Effect.runPromise(
		traceStore.appendTerminalEvent(params).pipe(Effect.catchAll(() => Effect.void)),
	)
}
