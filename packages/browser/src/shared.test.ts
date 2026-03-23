import { describe, expect, it } from "bun:test"
import { inferBrowserSideEffectLevel, isBrowserEscalationSignal } from "./shared"

describe("browser task normalization", () => {
	it("classifies read-heavy instructions as read side effects", () => {
		expect(inferBrowserSideEffectLevel("read the pricing page and summarize it")).toBe("read")
	})

	it("detects browser tasks that require computer escalation", () => {
		expect(
			isBrowserEscalationSignal(
				"this requires a file picker, download, and native dialog, so it should escalate",
			),
		).toBe(true)
	})
})
