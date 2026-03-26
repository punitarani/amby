import { describe, expect, it } from "bun:test"
import type { OpenThreadRow } from "./router"
import { routeMessage } from "./router"

const GAP_CONTINUE_MS = 120_000

function makeThread(partial: Partial<OpenThreadRow> & Pick<OpenThreadRow, "id">): OpenThreadRow {
	return {
		id: partial.id,
		label: partial.label ?? null,
		synopsis: partial.synopsis ?? null,
		keywords: partial.keywords ?? null,
		lastActiveAt: partial.lastActiveAt ?? new Date(),
	}
}

function recentTime(): Date {
	return new Date(Date.now() - 10_000) // 10s ago — within gap
}

function staleTime(): Date {
	return new Date(Date.now() - GAP_CONTINUE_MS - 10_000) // past the gap
}

describe("routeMessage", () => {
	describe("gap-based continue", () => {
		it("continues on current thread when gap < 120s", () => {
			const result = routeMessage("hello", "thread-1", recentTime(), [])
			expect(result).toEqual({
				action: "continue",
				threadId: "thread-1",
				source: "derived",
			})
		})

		it("does not auto-continue when gap >= 120s", () => {
			const result = routeMessage("hello", "thread-1", staleTime(), [])
			expect(result).toBeNull()
		})

		it("continues even with open threads when gap is small", () => {
			const threads = [makeThread({ id: "t-1", label: "hello" })]
			const result = routeMessage("hello", "thread-1", recentTime(), threads)
			expect(result?.action).toBe("continue")
		})
	})

	describe("label matching", () => {
		it("switches to thread with matching label", () => {
			const threads = [
				makeThread({ id: "t-billing", label: "billing" }),
				makeThread({ id: "t-auth", label: "auth" }),
			]
			const result = routeMessage("I have a billing question", "last", staleTime(), threads)
			expect(result).toEqual({
				action: "switch",
				threadId: "t-billing",
				source: "derived",
			})
		})

		it("matches labels case-insensitively", () => {
			const threads = [makeThread({ id: "t-1", label: "Deployment" })]
			const result = routeMessage("question about deployment", "last", staleTime(), threads)
			expect(result?.threadId).toBe("t-1")
		})

		it("requires word boundary for label match", () => {
			const threads = [makeThread({ id: "t-1", label: "test" })]
			const result = routeMessage("latest", "last", staleTime(), threads)
			expect(result).toBeNull()
		})

		it("ignores labels shorter than 3 characters", () => {
			const threads = [makeThread({ id: "t-1", label: "db" })]
			const result = routeMessage("update the db schema", "last", staleTime(), threads)
			expect(result).toBeNull()
		})

		it("does not throw on labels with regex special characters", () => {
			const threads = [makeThread({ id: "t-1", label: "project.config" })]
			// Without escaping, "." would match any character — should not throw
			expect(() =>
				routeMessage("check project.config settings", "last", staleTime(), threads),
			).not.toThrow()
		})

		it("matches labels containing regex meta-characters via escaping", () => {
			const threads = [makeThread({ id: "t-1", label: "project.config" })]
			const result = routeMessage("update the project.config file", "last", staleTime(), threads)
			expect(result?.threadId).toBe("t-1")
		})

		it("returns the first matching thread when multiple labels match", () => {
			const threads = [
				makeThread({ id: "t-1", label: "api design" }),
				makeThread({ id: "t-2", label: "api testing" }),
			]
			// "api" matches both, first wins
			const result = routeMessage("api design question", "last", staleTime(), threads)
			expect(result?.threadId).toBe("t-1")
		})
	})

	describe("keyword matching", () => {
		it("switches to thread with 2+ keyword hits", () => {
			const threads = [
				makeThread({
					id: "t-deploy",
					keywords: ["kubernetes", "deploy", "cluster", "helm"],
				}),
			]
			const result = routeMessage(
				"need to deploy and update the helm chart",
				"last",
				staleTime(),
				threads,
			)
			expect(result?.threadId).toBe("t-deploy")
			expect(result?.action).toBe("switch")
		})

		it("does not switch with only 1 keyword hit", () => {
			const threads = [
				makeThread({
					id: "t-deploy",
					keywords: ["kubernetes", "deploy", "cluster"],
				}),
			]
			const result = routeMessage("what is kubernetes doing here", "last", staleTime(), threads)
			expect(result).toBeNull()
		})

		it("ignores threads with no keywords", () => {
			const threads = [makeThread({ id: "t-1", keywords: null })]
			const result = routeMessage("anything goes", "last", staleTime(), threads)
			expect(result).toBeNull()
		})

		it("ignores threads with empty keywords array", () => {
			const threads = [makeThread({ id: "t-1", keywords: [] })]
			const result = routeMessage("anything goes", "last", staleTime(), threads)
			expect(result).toBeNull()
		})

		it("keyword matching respects word boundaries", () => {
			const threads = [
				makeThread({
					id: "t-1",
					keywords: ["test", "testing"],
				}),
			]
			// "latest" contains "test" but not at a word boundary
			const result = routeMessage("latest contest", "last", staleTime(), threads)
			expect(result).toBeNull()
		})

		it("keywords shorter than 3 chars are ignored", () => {
			const threads = [
				makeThread({
					id: "t-1",
					keywords: ["db", "ui", "go"],
				}),
			]
			const result = routeMessage("update the db and ui using go", "last", staleTime(), threads)
			expect(result).toBeNull()
		})
	})

	describe("label takes precedence over keywords", () => {
		it("prefers label match over keyword match", () => {
			const threads = [
				makeThread({ id: "t-label", label: "billing" }),
				makeThread({
					id: "t-keyword",
					keywords: ["billing", "invoice", "payment"],
				}),
			]
			const result = routeMessage("billing invoice payment", "last", staleTime(), threads)
			expect(result?.threadId).toBe("t-label")
		})
	})

	describe("returns null when no match", () => {
		it("returns null for unrelated message with stale gap", () => {
			const threads = [makeThread({ id: "t-1", label: "testing", keywords: ["jest", "vitest"] })]
			const result = routeMessage("how is the weather today", "last", staleTime(), threads)
			expect(result).toBeNull()
		})

		it("returns null with no open threads and stale gap", () => {
			const result = routeMessage("hello there", "last", staleTime(), [])
			expect(result).toBeNull()
		})
	})
})
