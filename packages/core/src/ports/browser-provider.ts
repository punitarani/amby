import { Context, type Effect } from "effect"
import type { CoreError } from "../errors/core-error"

/**
 * Browser task input/output types are deliberately loose here.
 * The @amby/browser package defines the concrete schemas.
 * The port only defines the contract shape.
 */
export interface BrowserTaskRequest {
	readonly task: string
	readonly url?: string
	readonly outputSchema?: unknown
	readonly options?: Record<string, unknown>
}

export interface BrowserTaskResponse {
	readonly status: "completed" | "failed"
	readonly output?: unknown
	readonly screenshot?: string
	readonly error?: string
	readonly metrics?: {
		durationMs?: number
		stepsCompleted?: number
	}
}

export interface BrowserProvider {
	readonly execute: (request: BrowserTaskRequest) => Effect.Effect<BrowserTaskResponse, CoreError>
	readonly isAvailable: () => Effect.Effect<boolean, CoreError>
}

export class BrowserPort extends Context.Tag("BrowserPort")<BrowserPort, BrowserProvider>() {}
