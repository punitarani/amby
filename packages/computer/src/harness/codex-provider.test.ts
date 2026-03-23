import { describe, expect, it } from "bun:test"
import { buildCodexConfigToml } from "./codex-provider"

describe("buildCodexConfigToml", () => {
	it("adds Playwright config when sandbox tasks request browser support", () => {
		const config = buildCodexConfigToml(true, true)

		expect(config).toContain(`notify = ["node", "../notify.js"]`)
		expect(config).toContain("[mcp_servers.playwright]")
		expect(config).toContain("@playwright/mcp@latest")
	})

	it("omits Playwright config when browser support is not requested", () => {
		const config = buildCodexConfigToml(false, false)
		expect(config).toBe("")
	})
})
