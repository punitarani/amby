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

/**
 * Curried error mapper with context prefix.  Passes through existing {@link SandboxError}s
 * to avoid double-wrapping.  Use as `catch` in `Effect.tryPromise` or with `Effect.mapError`.
 */
export const sandboxError =
	(context: string) =>
	(cause: unknown): SandboxError =>
		cause instanceof SandboxError
			? cause
			: new SandboxError({
					message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				})
