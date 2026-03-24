import { describe, expect, it } from "bun:test"
import {
	inferBrowserSideEffectLevel,
	isBrowserEscalationSignal,
	sanitizeBrowserStartUrl,
} from "./shared"

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

	it("returns soft-write for act-like instructions", () => {
		expect(inferBrowserSideEffectLevel("click the submit button")).toBe("soft-write")
		expect(inferBrowserSideEffectLevel("fill in the form and sign in")).toBe("soft-write")
	})

	it("sanitizes wrapped start URLs before browser execution", () => {
		expect(sanitizeBrowserStartUrl('"https://www.nytimes.com"')).toBe("https://www.nytimes.com/")
		expect(sanitizeBrowserStartUrl("(https://example.com/path)")).toBe("https://example.com/path")
	})
})
