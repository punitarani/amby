import { Effect, Layer } from "effect"
import { BrowserError, BrowserService } from "./shared"

export const BrowserServiceDisabledLive = Layer.succeed(BrowserService, {
	enabled: false,
	runTask: () =>
		Effect.fail(
			new BrowserError({
				message: "Browser delegation is not available in this runtime.",
			}),
		),
})
