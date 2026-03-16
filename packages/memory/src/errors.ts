import { Data } from "effect"

export class MemoryError extends Data.TaggedError("MemoryError")<{
	readonly message: string
	readonly cause?: unknown
}> {}
