import { Data } from "effect"

export class SandboxError extends Data.TaggedError("SandboxError")<{
	readonly message: string
	readonly cause?: unknown
}> {}

/** Map an unexpected defect (thrown value) into {@link SandboxError} for `Effect.tryPromise` catch. */
export function sandboxErrorFromDefect(cause: unknown): SandboxError {
	return new SandboxError({
		message: cause instanceof Error ? cause.message : String(cause),
		cause,
	})
}
