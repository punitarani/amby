import { describe, expect, it } from "bun:test"

async function readText(relativePath: string) {
	return await Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("Cloudflare worker surface", () => {
	it("exports the renamed Durable Objects and Workflows", async () => {
		const source = await readText("./worker.ts")

		for (const exportName of [
			"AmbyConversation",
			"AmbyChatState",
			"AmbyAgentExecution",
			"AmbySandboxProvision",
			"AmbyVolumeProvision",
		]) {
			expect(source).toContain(exportName)
		}
	})

	it("keeps Wrangler config aligned with the renamed worker entities", async () => {
		const source = await readText("../wrangler.toml")

		expect(source).toContain('{ name = "AMBY_CONVERSATION", class_name = "AmbyConversation" }')
		expect(source).toContain('{ name = "AMBY_CHAT_STATE", class_name = "AmbyChatState" }')
		expect(source).toContain('binding = "AMBY_AGENT_EXECUTION"')
		expect(source).toContain('class_name = "AmbyAgentExecution"')
		expect(source).toContain('binding = "AMBY_SANDBOX_PROVISION"')
		expect(source).toContain('class_name = "AmbySandboxProvision"')
		expect(source).toContain('binding = "AMBY_VOLUME_PROVISION"')
		expect(source).toContain('class_name = "AmbyVolumeProvision"')
		expect(source).toContain('tag = "v3"')
		expect(source).toContain('new_classes = ["AmbyConversation"]')
		expect(source).toContain('tag = "v4"')
		expect(source).toContain('new_sqlite_classes = ["AmbyChatState"]')

		expect(source).not.toContain('{ name = "CONVERSATION_SESSION", class_name = "ConversationSession" }')
		expect(source).not.toContain('{ name = "CHAT_STATE", class_name = "ChatStateDO" }')
		expect(source).not.toContain('binding = "AGENT_WORKFLOW"')
		expect(source).not.toContain('binding = "SANDBOX_WORKFLOW"')
		expect(source).not.toContain('binding = "VOLUME_WORKFLOW"')
	})
})
