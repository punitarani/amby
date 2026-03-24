import { describe, expect, it } from "bun:test"
import { STAGEHAND_MODEL } from "./workers"

describe("browser worker LLM config", () => {
	it("uses the Workers AI Kimi K2.5 model", () => {
		expect(STAGEHAND_MODEL).toBe("@cf/moonshotai/kimi-k2.5")
	})
})
