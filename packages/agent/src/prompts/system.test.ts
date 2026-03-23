import { describe, expect, it } from "bun:test"
import { buildSystemPrompt } from "./system"

describe("buildSystemPrompt", () => {
	it("documents the sandbox browser fallback when direct browser delegation is unavailable", () => {
		const prompt = buildSystemPrompt("Sunday, March 22, 2026 at 12:00:00 PM MST", "America/Phoenix", {
			browserEnabled: false,
			computerEnabled: false,
			integrationEnabled: false,
			sandboxEnabled: true,
		})

		expect(prompt).toContain('delegate_task with target="sandbox" and needsBrowser=true')
		expect(prompt).toContain("set needsBrowser=true on sandbox tasks")
	})
})
