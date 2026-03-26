import { describe, expect, it } from "bun:test"
import type { TaskStatus } from "@amby/db"
import { isLegalTransition, isTerminal, TERMINAL_STATUSES } from "./task-state"

const ALL_STATUSES: TaskStatus[] = [
	"pending",
	"awaiting_auth",
	"preparing",
	"running",
	"succeeded",
	"partial",
	"escalated",
	"failed",
	"cancelled",
	"timed_out",
	"lost",
]

const NON_TERMINAL: TaskStatus[] = ALL_STATUSES.filter((s) => !isTerminal(s))

describe("task-state transition matrix", () => {
	describe("terminal set", () => {
		it("TERMINAL_STATUSES contains exactly the expected members", () => {
			const expected: TaskStatus[] = [
				"succeeded",
				"partial",
				"escalated",
				"failed",
				"cancelled",
				"timed_out",
				"lost",
			]
			expect([...TERMINAL_STATUSES].sort()).toEqual([...expected].sort())
		})

		it("terminal + non-terminal covers all statuses", () => {
			const combined = [...TERMINAL_STATUSES, ...NON_TERMINAL].sort()
			expect(combined).toEqual([...ALL_STATUSES].sort())
		})
	})

	describe("identity transitions (from === to)", () => {
		it.each(ALL_STATUSES)("%s → %s is always allowed", (status) => {
			expect(isLegalTransition(status, status)).toBe(true)
		})
	})

	describe("terminal → non-terminal is always rejected", () => {
		for (const terminal of TERMINAL_STATUSES) {
			for (const nonTerminal of NON_TERMINAL) {
				it(`${terminal} → ${nonTerminal} is rejected`, () => {
					expect(isLegalTransition(terminal, nonTerminal)).toBe(false)
				})
			}
		}
	})

	describe("terminal → different terminal is always rejected", () => {
		for (const from of TERMINAL_STATUSES) {
			for (const to of TERMINAL_STATUSES) {
				if (from === to) continue
				it(`${from} → ${to} is rejected`, () => {
					expect(isLegalTransition(from, to)).toBe(false)
				})
			}
		}
	})

	describe("non-terminal → terminal is always allowed", () => {
		for (const nonTerminal of NON_TERMINAL) {
			for (const terminal of TERMINAL_STATUSES) {
				it(`${nonTerminal} → ${terminal} is allowed`, () => {
					expect(isLegalTransition(nonTerminal, terminal)).toBe(true)
				})
			}
		}
	})

	describe("specific non-terminal → non-terminal transitions", () => {
		const validTransitions: [TaskStatus, TaskStatus][] = [
			["pending", "preparing"],
			["pending", "running"],
			["pending", "awaiting_auth"],
			["awaiting_auth", "preparing"],
			["awaiting_auth", "running"],
			["awaiting_auth", "awaiting_auth"],
			["preparing", "running"],
		]

		it.each(validTransitions)("%s → %s is allowed", (from, to) => {
			expect(isLegalTransition(from, to)).toBe(true)
		})

		const invalidTransitions: [TaskStatus, TaskStatus][] = [
			["running", "pending"],
			["running", "preparing"],
			["running", "awaiting_auth"],
			["preparing", "pending"],
			["preparing", "awaiting_auth"],
			["pending", "pending"], // identity — covered above but verifying
		]

		// Filter out identity transitions since they're always true
		const strictlyInvalid = invalidTransitions.filter(([f, t]) => f !== t)

		it.each(strictlyInvalid)("%s → %s is rejected", (from, to) => {
			expect(isLegalTransition(from, to)).toBe(false)
		})
	})
})
