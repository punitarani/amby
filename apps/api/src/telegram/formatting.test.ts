import { describe, expect, it } from "bun:test"
import { renderTelegramMessageChunks } from "./formatting"

describe("renderTelegramMessageChunks", () => {
	it("converts markdown emphasis and lists into Telegram HTML", () => {
		const [chunk] = renderTelegramMessageChunks(
			[
				"The next BART trains departing from SFO are:",
				"",
				"- **Yellow Line (towards Antioch):** 1:53 AM",
				"- **Yellow Line (towards Antioch):** 2:23 AM",
			].join("\n"),
		)

		expect(chunk).toBeDefined()
		expect(chunk?.html).toContain("<b>Yellow Line (towards Antioch):</b>")
		expect(chunk?.html).toContain("• <b>Yellow Line (towards Antioch):</b> 1:53 AM")
		expect(chunk?.plainText).toContain("• Yellow Line (towards Antioch): 1:53 AM")
	})

	it("escapes raw HTML from the model output", () => {
		const [chunk] = renderTelegramMessageChunks("Use `<script>` literally.")
		expect(chunk?.html).toContain("&lt;script&gt;")
		expect(chunk?.html).not.toContain("<script>")
	})

	it("splits oversized output by parsed text length", () => {
		const chunks = renderTelegramMessageChunks(["**Alpha**", "Beta", "Gamma"].join("\n\n"), 10)

		expect(chunks).toHaveLength(3)
		expect(chunks[0]?.plainText.length).toBeLessThanOrEqual(12)
		expect(chunks[1]?.plainText.length).toBeLessThanOrEqual(12)
		expect(chunks[2]?.plainText.length).toBeLessThanOrEqual(12)
		expect(chunks[0]?.html).toContain("<b>Alpha</b>")
	})
})
