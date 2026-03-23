import { describe, expect, it } from "bun:test"
import { STAGEHAND_MODEL } from "./workers"

describe("browser worker LLM config", () => {
	it("uses a Workers AI catalog model id", () => {
		expect(STAGEHAND_MODEL).toMatch(/^@cf\//)
	})
})
