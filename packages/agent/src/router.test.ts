import { describe, expect, it } from "bun:test"
import { buildReplayMessages, formatArtifactRecap } from "./context"
import { routeMessage } from "./router"
import { extractTraceSummary, formatToolAnnotation, summarizeToolOutput } from "./traces"

describe("routeMessage", () => {
	const threads = [
		{
			id: "t1",
			label: "deployment",
			synopsis: "deploying the app",
			keywords: null,
			lastActiveAt: new Date(),
		},
		{
			id: "t2",
			label: "billing",
			synopsis: "billing discussion",
			keywords: ["invoice", "payment", "stripe"],
			lastActiveAt: new Date(),
		},
	]

	it("returns continue when gap is short", () => {
		const result = routeMessage("hello", "t1", new Date(), threads)
		expect(result).not.toBeNull()
		expect(result?.action).toBe("continue")
		expect(result?.threadId).toBe("t1")
		expect(result?.source).toBe("derived")
	})

	it("returns switch when message matches a thread label", () => {
		const oldDate = new Date(Date.now() - 300_000)
		const result = routeMessage("let's check billing", "t1", oldDate, threads)
		expect(result).not.toBeNull()
		expect(result?.action).toBe("switch")
		expect(result?.threadId).toBe("t2")
		expect(result?.source).toBe("derived")
	})

	it("returns null when ambiguous (no heuristic match)", () => {
		const oldDate = new Date(Date.now() - 300_000)
		const result = routeMessage("something unrelated", "t1", oldDate, threads)
		expect(result).toBeNull()
	})

	it("does NOT match short labels (< 3 chars)", () => {
		const shortLabelThreads = [
			{ id: "t1", label: "a", synopsis: null, keywords: null, lastActiveAt: new Date() },
		]
		const oldDate = new Date(Date.now() - 300_000)
		const result = routeMessage("about something", "t1", oldDate, shortLabelThreads)
		expect(result).toBeNull()
	})

	it("uses word boundary matching (label 'log' does NOT match 'dialog')", () => {
		const labelThreads = [
			{ id: "t1", label: "log", synopsis: null, keywords: null, lastActiveAt: new Date() },
		]
		const oldDate = new Date(Date.now() - 300_000)
		expect(routeMessage("check the dialog box", "t1", oldDate, labelThreads)).toBeNull()
		const match = routeMessage("check the log output", "t1", oldDate, labelThreads)
		expect(match?.action).toBe("switch")
	})

	it("switches on keyword match (2+ hits)", () => {
		const oldDate = new Date(Date.now() - 300_000)
		const result = routeMessage("send the invoice and payment details", "t1", oldDate, threads)
		expect(result).not.toBeNull()
		expect(result?.action).toBe("switch")
		expect(result?.threadId).toBe("t2")
		expect(result?.source).toBe("derived")
	})

	it("does NOT switch on single keyword hit", () => {
		const oldDate = new Date(Date.now() - 300_000)
		const result = routeMessage("check the invoice", "t1", oldDate, threads)
		expect(result).toBeNull()
	})
})

describe("buildReplayMessages", () => {
	it("filters out non-user/assistant roles", () => {
		const rows = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
			{ role: "tool", content: "result" },
		]
		const result = buildReplayMessages(rows)
		expect(result).toHaveLength(2)
		expect(result[0]?.role).toBe("user")
		expect(result[1]?.role).toBe("assistant")
	})

	it("annotates recent assistant messages with trace annotations", () => {
		const rows = Array.from({ length: 6 }, (_, i) => ({
			role: i % 2 === 0 ? "user" : "assistant",
			content: `msg-${i}`,
			traceAnnotation: i % 2 === 1 ? "[Tools used: search: found it]" : undefined,
		}))
		const result = buildReplayMessages(rows)
		const lastAssistant = result.at(-1)
		expect(lastAssistant?.content).toContain("[Tools used:")
	})
})

describe("formatToolAnnotation", () => {
	it("returns empty string for empty array", () => {
		expect(formatToolAnnotation([])).toBe("")
	})

	it("formats tool names with summaries", () => {
		const results = [
			{ toolName: "search", output: { summary: "found 3 results" } },
			{ toolName: "read_file", output: "raw text" },
		]
		const result = formatToolAnnotation(results)
		expect(result).toContain("search: found 3 results")
		expect(result).toContain("read_file")
		expect(result).toStartWith("[Tools used:")
	})
})

describe("formatArtifactRecap", () => {
	it("returns empty string when no artifacts", () => {
		expect(formatArtifactRecap([], null)).toBe("")
	})

	it("builds bullet list from trace annotations", () => {
		const rows = [
			{
				content: "done",
				traceAnnotation: "Created file foo.ts",
			},
			{
				content: "also done",
				traceAnnotation: "Ran tests",
			},
		]
		const result = formatArtifactRecap(rows, "my-thread")
		expect(result).toContain("## Thread context (my-thread)")
		expect(result).toContain("- Created file foo.ts")
		expect(result).toContain("- Ran tests")
	})
})

describe("summarizeToolOutput", () => {
	it("returns short strings unchanged", () => {
		expect(summarizeToolOutput("hello")).toBe("hello")
	})

	it("truncates long strings at word boundary", () => {
		const longStr = "word ".repeat(200) // 1000 chars
		const result = summarizeToolOutput(longStr) as string
		expect(result.length).toBeLessThanOrEqual(502) // 500 + ellipsis char
		expect(result).toEndWith("…")
		const withoutEllipsis = result.slice(0, -1)
		expect(withoutEllipsis).toEndWith("word")
	})

	it("passes through objects with summary field", () => {
		const obj = { summary: "test" }
		expect(summarizeToolOutput(obj)).toBe(obj)
	})
})

describe("extractTraceSummary", () => {
	it("returns undefined fields for empty steps", () => {
		const result = extractTraceSummary([])
		expect(result.toolCalls).toBeUndefined()
		expect(result.toolResults).toBeUndefined()
	})

	it("flattens tool calls and results from steps", () => {
		const steps = [
			{
				toolCalls: [{ toolCallId: "c1", toolName: "search", input: { q: "test" } }],
				toolResults: [{ toolCallId: "c1", toolName: "search", output: "found" }],
			},
			{
				toolCalls: [{ toolCallId: "c2", toolName: "read", input: { path: "/" } }],
				toolResults: [{ toolCallId: "c2", toolName: "read", output: "content" }],
			},
		]
		const result = extractTraceSummary(steps)
		expect(result.toolCalls).toHaveLength(2)
		expect(result.toolResults).toHaveLength(2)
		expect(result.toolCalls?.[0]?.toolName).toBe("search")
		expect(result.toolCalls?.[1]?.toolName).toBe("read")
	})
})

describe("generateSynopsis return type", () => {
	it("generateSynopsis is exported from router", async () => {
		const { generateSynopsis } = await import("./router")
		expect(typeof generateSynopsis).toBe("function")
	})
})
