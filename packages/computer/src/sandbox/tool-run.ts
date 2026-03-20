import type { Sandbox } from "@daytonaio/sdk"
import { Effect } from "effect"
import type { SandboxError } from "../errors"

export type SandboxToolChannel = "computer" | "cua"

/**
 * Runs `ensure` then `fn` for Vercel AI `tool().execute` handlers.
 * Maps {@link SandboxError} / defects to user-facing strings; logs to console.
 */
export async function runWithEnsuredSandbox<T>(
	ensure: Effect.Effect<Sandbox, SandboxError>,
	fn: (sandbox: Sandbox) => Promise<T>,
	options: { logPrefix: string; channel: SandboxToolChannel },
): Promise<T | string> {
	try {
		const instance = await Effect.runPromise(ensure)
		return await fn(instance)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		const detail = err instanceof Error && err.cause ? ` | cause: ${err.cause}` : ""
		console.error(`[${options.logPrefix}] Error: ${message}${detail}`)
		if (options.channel === "computer" && err instanceof Error && err.stack) {
			console.error(`[${options.logPrefix}] Stack: ${err.stack}`)
		}
		if (message.includes("not configured")) {
			return options.channel === "computer"
				? "Computer access is not available — DAYTONA_API_KEY is not configured. Let the user know they can enable sandbox features by setting up a Daytona API key in their .env file (sign up at https://app.daytona.io)."
				: "Computer access is not available — DAYTONA_API_KEY is not configured."
		}
		return options.channel === "computer"
			? `Sandbox error: ${message}. The sandbox may be temporarily unavailable. Try again in a moment.`
			: `CUA error: ${message}. Try again in a moment.`
	}
}
