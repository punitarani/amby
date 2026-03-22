import { describe, expect, it } from "bun:test"
import {
	buildReplayMessages,
	extractTraceData,
	extractTraceSummary,
	formatArtifactRecap,
	formatToolAnnotation,
	summarizeToolOutput,
} from "./agent"
import { routeMessage } from "./router"

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
		expect(result?.confidence).toBe(0.85)
	})

	it("returns switch when message matches a thread label", () => {
		const oldDate = new Date(Date.now() - 300_000)
		const result = routeMessage("let's check billing", "t1", oldDate, threads)
		expect(result).not.toBeNull()
		expect(result?.action).toBe("switch")
		expect(result?.threadId).toBe("t2")
		expect(result?.confidence).toBe(0.8)
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
		expect(result?.confidence).toBe(0.78)
	})

	it("does NOT switch on single keyword hit", () => {
		const oldDate = new Date(Date.now() - 300_000)
		const result = routeMessage("check the invoice", "t1", oldDate, threads)
		// Single keyword hit is not enough — should fall through to null
		expect(result).toBeNull()
	})
})

describe("buildReplayMessages", () => {
	it("filters out non-user/assistant roles", () => {
		const rows = [
			{ role: "system", content: "sys", toolCalls: null, toolResults: null },
			{ role: "user", content: "hi", toolCalls: null, toolResults: null },
			{ role: "assistant", content: "hello", toolCalls: null, toolResults: null },
			{ role: "tool", content: "result", toolCalls: null, toolResults: null },
		]
		const result = buildReplayMessages(rows)
		expect(result).toHaveLength(2)
		expect(result[0]?.role).toBe("user")
		expect(result[1]?.role).toBe("assistant")
	})

	it("annotates recent assistant messages with tool results", () => {
		const rows = Array.from({ length: 6 }, (_, i) => ({
			role: i % 2 === 0 ? "user" : "assistant",
			content: `msg-${i}`,
			toolCalls: null,
			toolResults: i % 2 === 1 ? [{ toolName: "search", output: { summary: "found it" } }] : null,
		}))
		const result = buildReplayMessages(rows)
		// Last RECENT_WITH_TOOLS=4 filtered messages get annotations
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

	it("builds bullet list from tool result summaries", () => {
		const rows = [
			{
				content: "done",
				toolResults: [
					{ output: { summary: "Created file foo.ts" } },
					{ output: { summary: "Ran tests" } },
				],
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
		// Should cut at a space boundary
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

	it("is aliased as extractTraceData for backwards compatibility", () => {
		expect(extractTraceData).toBe(extractTraceSummary)
	})
})

describe("generateSynopsis return type", () => {
	// This test validates the type contract — generateSynopsis returns { synopsis, keywords }
	// We can't easily test the actual LLM call, but we verify the import works
	it("generateSynopsis is exported from router", async () => {
		const { generateSynopsis } = await import("./router")
		expect(typeof generateSynopsis).toBe("function")
	})
})
