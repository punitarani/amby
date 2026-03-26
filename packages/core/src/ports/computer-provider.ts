import { Context, type Effect } from "effect"
import type { CoreError } from "../errors/core-error"

export interface ComputerTaskRequest {
	readonly prompt: string
	readonly userId: string
	readonly threadId?: string
	readonly requiresBrowser?: boolean
	readonly instructions?: string
	readonly options?: Record<string, unknown>
}

export interface ComputerTaskResponse {
	readonly taskId: string
	readonly status: "started" | "completed" | "failed"
	readonly summary?: string
	readonly output?: unknown
	readonly artifacts?: unknown[]
	readonly error?: string
}

export interface ComputerProvider {
	readonly startTask: (
		request: ComputerTaskRequest,
	) => Effect.Effect<ComputerTaskResponse, CoreError>
	readonly queryTask: (taskId: string) => Effect.Effect<ComputerTaskResponse, CoreError>
	readonly isAvailable: () => Effect.Effect<boolean, CoreError>
}

export class ComputerPort extends Context.Tag("ComputerPort")<ComputerPort, ComputerProvider>() {}
