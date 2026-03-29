import { describe, expect, it } from "bun:test"
import {
	renderTelegramMarkdownChunks,
	renderTelegramMarkdownToHtml,
	splitTelegramHtml,
} from "./render-markdown"

describe("renderTelegramMarkdownToHtml", () => {
	it("renders bold, italic, links, and inline code with Telegram HTML", () => {
		expect(
			renderTelegramMarkdownToHtml(
				"Use **bold**, _italic_, [docs](https://example.com?q=1&x=2), and `code`.",
			),
		).toBe(
			'Use <b>bold</b>, <i>italic</i>, <a href="https://example.com?q=1&amp;x=2">docs</a>, and <code>code</code>.',
		)
	})

	it("renders unordered and ordered markdown lists as Telegram-safe lines", () => {
		expect(renderTelegramMarkdownToHtml("- one\n- two\n\n1. first\n2. second")).toBe(
			"- one\n- two\n\n1. first\n2. second",
		)
	})

	it("renders blockquotes and fenced code blocks with supported Telegram tags", () => {
		expect(renderTelegramMarkdownToHtml("> quoted\n> text\n\n```ts\nconst x = 1\n```")).toBe(
			'<blockquote>quoted text</blockquote>\n\n<pre><code class="language-ts">const x = 1\n</code></pre>',
		)
	})

	it("renders markdown tables as ASCII inside preformatted text", () => {
		expect(
			renderTelegramMarkdownToHtml("| Name | Role |\n| ---- | ---- |\n| Ada | Eng |\n| Bob | PM |"),
		).toBe("<pre>Name | Role\n-----|-----\nAda  | Eng\nBob  | PM</pre>")
	})

	it("renders task lists as plain checklist markers", () => {
		expect(renderTelegramMarkdownToHtml("- [x] shipped\n- [ ] todo")).toBe(
			"- [x] shipped\n- [ ] todo",
		)
	})
})

describe("splitTelegramHtml", () => {
	it("keeps formatting tags balanced when splitting long rendered text", () => {
		const chunks = splitTelegramHtml(`<b>Hello world</b> ${"alpha ".repeat(30)}<i>tail</i>`, 80)

		expect(chunks.length).toBeGreaterThan(1)
		for (const chunk of chunks) {
			expect(chunk).not.toContain("<b><")
			expect(chunk.split("<b>").length - 1).toBe(chunk.split("</b>").length - 1)
			expect(chunk.split("<i>").length - 1).toBe(chunk.split("</i>").length - 1)
		}
	})
})

describe("renderTelegramMarkdownChunks", () => {
	it("returns HTML parse-mode chunks ready for Telegram sendMessage", () => {
		expect(renderTelegramMarkdownChunks("**bold** text", 4096)).toEqual([
			{ text: "<b>bold</b> text", parseMode: "HTML" },
		])
	})
})
