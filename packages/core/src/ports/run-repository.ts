import { Context, type Effect } from "effect"
import type { Run, RunEvent, RunEventKind, RunStatus } from "../domain/execution"
import type { CoreError } from "../errors/core-error"

export interface RunRepository {
	readonly create: (params: {
		conversationId: string
		threadId: string
		triggerMessageId?: string
		mode: Run["mode"]
		modelId: string
	}) => Effect.Effect<Run, CoreError>

	readonly findById: (id: string) => Effect.Effect<Run | undefined, CoreError>

	readonly updateStatus: (
		id: string,
		status: RunStatus,
		fields?: Partial<Pick<Run, "summary" | "responseJson" | "completedAt">>,
	) => Effect.Effect<void, CoreError>

	readonly appendEvent: (params: {
		runId: string
		seq: number
		kind: RunEventKind
		payload: Record<string, unknown>
	}) => Effect.Effect<RunEvent, CoreError>

	readonly findEvents: (
		runId: string,
		options?: { afterSeq?: number; limit?: number },
	) => Effect.Effect<RunEvent[], CoreError>
}

export class RunRepo extends Context.Tag("RunRepo")<RunRepo, RunRepository>() {}
