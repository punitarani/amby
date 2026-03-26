import { Data } from "effect"

export class AutomationError extends Data.TaggedError("AutomationError")<{
	readonly message: string
	readonly cause?: unknown
}> {}
