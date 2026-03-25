import { describe, expect, it } from "bun:test"
import { createPluginRegistry } from "@amby/core"
import { Effect } from "effect"
import { createSkillsPlugin } from "./plugin"
import type { SkillService } from "./skill-service"

function makeSkillService(overrides?: Partial<SkillService>): SkillService {
	return {
		discover: overrides?.discover ?? (() => Effect.succeed([])),
		activate:
			overrides?.activate ??
			((manifest) =>
				Effect.succeed({
					id: manifest.id,
					title: "test",
					instructions: "do the thing",
					references: [],
					requiredCapabilities: [],
				})),
		findById: overrides?.findById ?? (() => Effect.succeed(undefined)),
		search: overrides?.search ?? (() => Effect.succeed([])),
	}
}

describe("createSkillsPlugin", () => {
	it("has id 'skills'", () => {
		const plugin = createSkillsPlugin(makeSkillService())
		expect(plugin.id).toBe("skills")
	})

	it("registers 1 context contributor, 1 tool provider, and 1 planner hint provider", () => {
		const registry = createPluginRegistry()
		createSkillsPlugin(makeSkillService()).register(registry)

		expect(registry.contextContributors).toHaveLength(1)
		expect(registry.contextContributors[0]?.id).toBe("skills:available")

		expect(registry.toolProviders).toHaveLength(1)
		expect(registry.toolProviders[0]?.id).toBe("skills:tools")
		expect(registry.toolProviders[0]?.group).toBe("settings")

		expect(registry.plannerHintProviders).toHaveLength(1)
		expect(registry.plannerHintProviders[0]?.id).toBe("skills:hints")
	})

	it("does not register task runners or event handlers", () => {
		const registry = createPluginRegistry()
		createSkillsPlugin(makeSkillService()).register(registry)

		expect(registry.taskRunners).toHaveLength(0)
		expect(registry.eventHandlers).toHaveLength(0)
	})
})

describe("skills context contributor", () => {
	it("returns undefined when no skills are discovered", async () => {
		const registry = createPluginRegistry()
		createSkillsPlugin(makeSkillService()).register(registry)

		const contributor = registry.contextContributors[0]
		const result = await contributor?.contribute({
			userId: "user-1",
			conversationId: "conv-1",
			threadId: "thread-1",
		})
		expect(result).toBeUndefined()
	})

	it("returns formatted text when skills are available", async () => {
		const service = makeSkillService({
			discover: () =>
				Effect.succeed([
					{
						id: "simplify",
						title: "Simplify",
						description: "Simplify code complexity",
						path: "/skills/simplify",
						requiredCapabilities: [],
					},
					{
						id: "review",
						title: "Code Review",
						description: "Review pull requests",
						path: "/skills/review",
						requiredCapabilities: [],
					},
				]),
		})

		const registry = createPluginRegistry()
		createSkillsPlugin(service).register(registry)

		const contributor = registry.contextContributors[0]
		const result = await contributor?.contribute({
			userId: "user-1",
			conversationId: "conv-1",
			threadId: "thread-1",
		})
		expect(result).toContain("Available Skills")
		expect(result).toContain("Simplify")
		expect(result).toContain("Code Review")
	})
})

describe("skills tool provider", () => {
	it("returns list_skills and activate_skill tools", async () => {
		const registry = createPluginRegistry()
		createSkillsPlugin(makeSkillService()).register(registry)

		const provider = registry.toolProviders[0]
		const tools = await provider?.getTools({
			userId: "user-1",
			conversationId: "conv-1",
			threadId: "thread-1",
		})
		expect(tools).toHaveProperty("list_skills")
		expect(tools).toHaveProperty("activate_skill")
	})
})

describe("skills planner hint provider", () => {
	it("returns undefined when no skills are available", async () => {
		const registry = createPluginRegistry()
		createSkillsPlugin(makeSkillService()).register(registry)

		const provider = registry.plannerHintProviders[0]
		const result = await provider?.getHints({
			userId: "user-1",
			conversationId: "conv-1",
			threadId: "thread-1",
		})
		expect(result).toBeUndefined()
	})

	it("returns hint text when skills are available", async () => {
		const service = makeSkillService({
			discover: () =>
				Effect.succeed([
					{
						id: "simplify",
						title: "Simplify",
						description: "Simplify code",
						path: "/skills/simplify",
						requiredCapabilities: [],
					},
				]),
		})

		const registry = createPluginRegistry()
		createSkillsPlugin(service).register(registry)

		const provider = registry.plannerHintProviders[0]
		const result = await provider?.getHints({
			userId: "user-1",
			conversationId: "conv-1",
			threadId: "thread-1",
		})
		expect(result).toContain("Available skills")
		expect(result).toContain("Simplify")
		expect(result).toContain("list_skills")
		expect(result).toContain("activate_skill")
	})
})
