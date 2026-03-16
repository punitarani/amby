import { Data } from "effect"

export class AgentError extends Data.TaggedError("AgentError")<{
	readonly message: string
	readonly cause?: unknown
}> {}
