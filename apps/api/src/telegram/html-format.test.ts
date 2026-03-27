import { describe, expect, it } from "bun:test"
import {
	escapeTelegramHtml,
	renderTelegramHtmlFromMarkdown,
	splitTelegramHtmlMessage,
	telegramHtml,
} from "./html-format"

describe("telegramHtml", () => {
	it("wraps raw HTML in a postable message shape", () => {
		expect(telegramHtml("<b>Hello</b>")).toEqual({ raw: "<b>Hello</b>" })
	})
})

describe("escapeTelegramHtml", () => {
	it("escapes Telegram HTML special characters", () => {
		expect(escapeTelegramHtml("5 < 6 & 7 > 3")).toBe("5 &lt; 6 &amp; 7 &gt; 3")
	})
})

describe("renderTelegramHtmlFromMarkdown", () => {
	it("renders bold text and lists as Telegram-safe HTML", () => {
		const rendered = renderTelegramHtmlFromMarkdown("* **Yellow Line:** 1:53 AM")

		expect(rendered).toContain("• ")
		expect(rendered).toContain("<b>Yellow Line:</b>")
		expect(rendered).not.toContain("**Yellow Line:**")
	})
})

describe("splitTelegramHtmlMessage", () => {
	it("closes and reopens tags across chunks", () => {
		const html = `<b>${"a".repeat(4097)}</b>`
		const chunks = splitTelegramHtmlMessage(html, 4096)

		expect(chunks).toHaveLength(2)
		expect(chunks[0]).toStartWith("<b>")
		expect(chunks[0]).toEndWith("</b>")
		expect(chunks[1]).toStartWith("<b>")
		expect(chunks[1]).toEndWith("</b>")
	})

	it("splits on whitespace when possible", () => {
		const html = `Hello <b>${"world ".repeat(900)}</b>done`
		const chunks = splitTelegramHtmlMessage(html, 4096)

		expect(chunks.length).toBeGreaterThan(1)
		expect(chunks[0]).toEndWith("</b>")
		expect(chunks[1]).toStartWith("<b>")
	})
})
