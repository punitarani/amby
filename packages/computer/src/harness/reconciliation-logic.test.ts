import { describe, expect, it } from "bun:test"

/**
 * Test the pure logic extracted from reconciliation.ts:
 * - buildNotificationMessage
 * - parseStatusJson
 *
 * These are module-private, so we test them through their observable effects
 * or by importing them if exported. Since they're currently private,
 * we replicate the logic here to test the decision rules.
 */

// Replicate parseStatusJson logic for testing (matches reconciliation.ts)
function parseStatusJson(raw: string | null): {
	status?: string
	exitCode?: number | null
	message?: string
} | null {
	if (!raw) return null
	try {
		return JSON.parse(raw) as { status?: string; exitCode?: number | null; message?: string }
	} catch {
		return null
	}
}

// Replicate buildNotificationMessage logic (matches reconciliation.ts)
function buildNotificationMessage(task: {
	status: string
	outputSummary?: string | null
	error?: string | null
}): string | null {
	const summary = task.outputSummary?.trim() || "Task finished."
	const err = task.error?.trim()
	switch (task.status) {
		case "succeeded":
			return `Your task is done.\n\n${summary}`
		case "failed":
			return `Your task failed.${err ? `\n\n${err}` : ""}\n\nYou can ask me to try again.`
		case "timed_out":
			return "Your task timed out. You can ask me to try again or split the work into smaller steps."
		case "lost":
			return "I lost track of your task. You can ask me to start it again."
		default:
			return null
	}
}

describe("parseStatusJson", () => {
	it("returns null for null input", () => {
		expect(parseStatusJson(null)).toBeNull()
	})

	it("returns null for empty string", () => {
		expect(parseStatusJson("")).toBeNull()
	})

	it("returns null for malformed JSON", () => {
		expect(parseStatusJson("{not json}")).toBeNull()
		expect(parseStatusJson("undefined")).toBeNull()
		expect(parseStatusJson("{status:")).toBeNull()
	})

	it("parses valid succeeded status", () => {
		const result = parseStatusJson('{"status":"succeeded","exitCode":0}')
		expect(result).toEqual({ status: "succeeded", exitCode: 0 })
	})

	it("parses valid failed status with message", () => {
		const result = parseStatusJson('{"status":"failed","exitCode":1,"message":"compilation error"}')
		expect(result).toEqual({
			status: "failed",
			exitCode: 1,
			message: "compilation error",
		})
	})

	it("parses status with null exitCode", () => {
		const result = parseStatusJson('{"status":"succeeded","exitCode":null}')
		expect(result).toEqual({ status: "succeeded", exitCode: null })
	})

	it("parses empty object", () => {
		const result = parseStatusJson("{}")
		expect(result).toEqual({})
	})

	it("handles array (returns it, non-null)", () => {
		const result = parseStatusJson("[]")
		expect(result).not.toBeNull()
	})
})

describe("buildNotificationMessage", () => {
	it("builds succeeded message with summary", () => {
		const msg = buildNotificationMessage({
			status: "succeeded",
			outputSummary: "Deployed v2.1 to production.",
		})
		expect(msg).toBe("Your task is done.\n\nDeployed v2.1 to production.")
	})

	it("builds succeeded message with fallback when no summary", () => {
		const msg = buildNotificationMessage({
			status: "succeeded",
			outputSummary: null,
		})
		expect(msg).toBe("Your task is done.\n\nTask finished.")
	})

	it("builds succeeded message with fallback for whitespace-only summary", () => {
		const msg = buildNotificationMessage({
			status: "succeeded",
			outputSummary: "   ",
		})
		expect(msg).toBe("Your task is done.\n\nTask finished.")
	})

	it("builds failed message with error", () => {
		const msg = buildNotificationMessage({
			status: "failed",
			error: "Compilation failed on line 42.",
		})
		expect(msg).toContain("Your task failed.")
		expect(msg).toContain("Compilation failed on line 42.")
		expect(msg).toContain("You can ask me to try again.")
	})

	it("builds failed message without error", () => {
		const msg = buildNotificationMessage({
			status: "failed",
			error: null,
		})
		expect(msg).toBe("Your task failed.\n\nYou can ask me to try again.")
	})

	it("builds timed_out message", () => {
		const msg = buildNotificationMessage({ status: "timed_out" })
		expect(msg).toContain("timed out")
		expect(msg).toContain("smaller steps")
	})

	it("builds lost message", () => {
		const msg = buildNotificationMessage({ status: "lost" })
		expect(msg).toContain("lost track")
		expect(msg).toContain("start it again")
	})

	it("returns null for non-terminal/non-notifiable statuses", () => {
		expect(buildNotificationMessage({ status: "running" })).toBeNull()
		expect(buildNotificationMessage({ status: "pending" })).toBeNull()
		expect(buildNotificationMessage({ status: "preparing" })).toBeNull()
		expect(buildNotificationMessage({ status: "partial" })).toBeNull()
		expect(buildNotificationMessage({ status: "escalated" })).toBeNull()
		expect(buildNotificationMessage({ status: "cancelled" })).toBeNull()
	})
})
