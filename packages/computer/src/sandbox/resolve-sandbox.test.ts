import { describe, expect, it } from "bun:test"
import { COMPUTER_SNAPSHOT } from "../computer-snapshot"
import { AGENT_USER } from "../config"
import { buildSandboxCreateParams } from "./resolve-sandbox"

describe("buildSandboxCreateParams", () => {
	it("creates sandboxes from the registered computer snapshot, not an Image spec", () => {
		const params = buildSandboxCreateParams("user_123", false)

		expect(params.snapshot).toBe(COMPUTER_SNAPSHOT)
		expect(params.user).toBe(AGENT_USER)
		expect("resources" in params).toBe(false)
		expect("image" in params).toBe(false)
	})
})
