import { describe, expect, it } from "bun:test"
import { computeNextCronRun } from "./cron"

describe("computeNextCronRun", () => {
	it("returns a future Date for a valid cron expression", () => {
		const next = computeNextCronRun("0 8 * * *", "UTC")
		expect(next).toBeInstanceOf(Date)
		expect(next?.getTime()).toBeGreaterThan(Date.now() - 60_000)
	})

	it("returns undefined for an invalid cron expression", () => {
		expect(computeNextCronRun("not a cron", "UTC")).toBeUndefined()
	})

	it("respects timezone", () => {
		const utc = computeNextCronRun("0 8 * * *", "UTC")
		const eastern = computeNextCronRun("0 8 * * *", "America/New_York")
		expect(utc).toBeInstanceOf(Date)
		expect(eastern).toBeInstanceOf(Date)
		// The two should differ because of the timezone offset
		expect(utc?.getTime()).not.toBe(eastern?.getTime())
	})

	it("handles every-minute cron", () => {
		const next = computeNextCronRun("* * * * *", "UTC")
		expect(next).toBeInstanceOf(Date)
		// Should be within the next 60 seconds
		const diffMs = (next?.getTime() ?? 0) - Date.now()
		expect(diffMs).toBeGreaterThan(0)
		expect(diffMs).toBeLessThanOrEqual(60_000)
	})
})
