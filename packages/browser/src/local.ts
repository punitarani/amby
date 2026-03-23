import { Effect, Layer } from "effect"
import { BrowserError, BrowserService } from "./shared"

export const BrowserServiceDisabledLive = Layer.succeed(BrowserService, {
	enabled: false,
	runTask: () =>
		Effect.fail(
			new BrowserError({
				message:
					"Headless browsing is not available in this runtime (browser not configured). Tell the user plainly — do not invent vague blocks.",
			}),
		),
})
