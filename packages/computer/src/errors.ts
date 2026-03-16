import { Data } from "effect"

export class SandboxError extends Data.TaggedError("SandboxError")<{
	readonly message: string
	readonly cause?: unknown
}> {}
