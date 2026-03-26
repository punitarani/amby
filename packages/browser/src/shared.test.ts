import { describe, expect, it } from "bun:test"
import {
	inferBrowserSideEffectLevel,
	isBrowserEscalationSignal,
	isRetryableBrowserTaskError,
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

describe("isRetryableBrowserTaskError", () => {
	it("treats transient HTTP and upstream signals as retryable", () => {
		expect(isRetryableBrowserTaskError(new Error("504 Gateway Time-out"))).toBe(true)
		expect(isRetryableBrowserTaskError(new Error("502 Bad Gateway"))).toBe(true)
		expect(isRetryableBrowserTaskError(new Error("503 Service Unavailable"))).toBe(true)
		expect(isRetryableBrowserTaskError(new Error("Gateway Time-out"))).toBe(true)
		expect(isRetryableBrowserTaskError(new Error("InferenceUpstreamError: timeout"))).toBe(true)
		expect(isRetryableBrowserTaskError(new Error("ECONNRESET"))).toBe(true)
		expect(isRetryableBrowserTaskError(new Error("fetch failed"))).toBe(true)
	})

	it("does not treat unrelated failures as retryable", () => {
		expect(isRetryableBrowserTaskError(new Error("invalid API key"))).toBe(false)
		expect(isRetryableBrowserTaskError(new Error("validation failed"))).toBe(false)
	})
})
