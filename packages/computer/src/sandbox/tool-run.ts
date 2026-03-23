import type { Sandbox } from "@daytonaio/sdk"
import { Effect } from "effect"
import type { SandboxError } from "../errors"

const LOG_PREFIX = "[sandbox]"

/**
 * Runs `ensure` then `fn` for Vercel AI `tool().execute` handlers.
 * Maps {@link SandboxError} / defects to user-facing strings; logs to console.
 */
export async function runWithEnsuredSandbox<T>(
	ensure: Effect.Effect<Sandbox, SandboxError>,
	fn: (sandbox: Sandbox) => Promise<T>,
): Promise<T | string> {
	const result = await Effect.runPromise(Effect.either(ensure))

	if (result._tag === "Left") {
		const err = result.left
		if (err.transient) {
			console.warn(`${LOG_PREFIX} ${err.message}`)
			return err.message
		} else {
			console.error(`${LOG_PREFIX} Error: ${err.message}`)
			if (err.stack) console.error(`${LOG_PREFIX} Stack: ${err.stack}`)
			return `Sandbox error: ${err.message}. The sandbox may be temporarily unavailable. Try again in a moment.`
		}
	}

	try {
		return await fn(result.right)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		const detail = err instanceof Error && err.cause ? ` | cause: ${err.cause}` : ""
		console.error(`${LOG_PREFIX} Error: ${message}${detail}`)
		if (err instanceof Error && err.stack) {
			console.error(`${LOG_PREFIX} Stack: ${err.stack}`)
		}
		return `Sandbox error: ${message}. The sandbox may be temporarily unavailable. Try again in a moment.`
	}
}
