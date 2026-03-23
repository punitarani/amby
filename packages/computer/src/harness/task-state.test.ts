import { describe, expect, it } from "bun:test"
import { isLegalTransition, isTerminal } from "./task-state"

describe("isTerminal", () => {
	it.each([
		"succeeded",
		"partial",
		"escalated",
		"failed",
		"cancelled",
		"timed_out",
		"lost",
	] as const)("returns true for terminal status %s", (status) => {
		expect(isTerminal(status)).toBe(true)
	})

	it.each([
		"pending",
		"awaiting_auth",
		"preparing",
		"running",
	] as const)("returns false for non-terminal status %s", (status) => {
		expect(isTerminal(status)).toBe(false)
	})
})

describe("isLegalTransition", () => {
	it("allows identity transitions (same → same)", () => {
		expect(isLegalTransition("running", "running")).toBe(true)
		expect(isLegalTransition("succeeded", "succeeded")).toBe(true)
	})

	it("rejects terminal → different status", () => {
		expect(isLegalTransition("succeeded", "running")).toBe(false)
		expect(isLegalTransition("failed", "pending")).toBe(false)
		expect(isLegalTransition("cancelled", "succeeded")).toBe(false)
	})

	it("allows non-terminal → terminal", () => {
		expect(isLegalTransition("running", "succeeded")).toBe(true)
		expect(isLegalTransition("running", "failed")).toBe(true)
		expect(isLegalTransition("pending", "cancelled")).toBe(true)
		expect(isLegalTransition("preparing", "timed_out")).toBe(true)
	})

	it("allows valid non-terminal → non-terminal transitions", () => {
		expect(isLegalTransition("pending", "preparing")).toBe(true)
		expect(isLegalTransition("pending", "running")).toBe(true)
		expect(isLegalTransition("awaiting_auth", "preparing")).toBe(true)
		expect(isLegalTransition("awaiting_auth", "running")).toBe(true)
		expect(isLegalTransition("preparing", "running")).toBe(true)
	})

	it("rejects invalid non-terminal → non-terminal transitions", () => {
		expect(isLegalTransition("running", "pending")).toBe(false)
		expect(isLegalTransition("running", "preparing")).toBe(false)
		expect(isLegalTransition("preparing", "pending")).toBe(false)
	})
})
