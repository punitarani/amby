import { Data } from "effect"

export class ModelError extends Data.TaggedError("ModelError")<{
	readonly message: string
	readonly cause?: unknown
}> {}
