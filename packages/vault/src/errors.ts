import { Data } from "effect"

export class VaultError extends Data.TaggedError("VaultError")<{
	readonly message: string
	readonly cause?: unknown
}> {}

/** Map an unknown thrown value into a {@link VaultError}. Used in `Effect.mapError` and `catch` positions. */
export const vaultErrorFrom = (cause: unknown): VaultError =>
	new VaultError({
		message: cause instanceof Error ? cause.message : String(cause),
		cause,
	})
