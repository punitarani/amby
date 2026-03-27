import { describe, expect, it } from "bun:test"
import { createPluginRegistry } from "@amby/core"
import { Effect } from "effect"
import { createMemoryPlugin } from "./plugin"
import type { MemoryService } from "./repository"

type MemoryOps = import("effect").Context.Tag.Service<typeof MemoryService>

function makeMemoryService(overrides?: Partial<MemoryOps>): MemoryOps {
	return {
		add: overrides?.add ?? (() => Effect.succeed("mem-123")),
		getProfile: overrides?.getProfile ?? (() => Effect.succeed({ static: [], dynamic: [] })),
		deactivate: overrides?.deactivate ?? (() => Effect.void),
	}
}

describe("createMemoryPlugin", () => {
	it("has id 'memory'", () => {
		const plugin = createMemoryPlugin(makeMemoryService())
		expect(plugin.id).toBe("memory")
	})

	it("registers 1 context contributor and 1 tool provider", () => {
		const registry = createPluginRegistry()
		const plugin = createMemoryPlugin(makeMemoryService())
		plugin.register(registry)

		expect(registry.contextContributors).toHaveLength(1)
		expect(registry.contextContributors[0]?.id).toBe("memory:profile")
		expect(registry.toolProviders).toHaveLength(1)
		expect(registry.toolProviders[0]?.id).toBe("memory:tools")
		expect(registry.toolProviders[0]?.group).toBe("memory")
	})

	it("does not register planner hints, task runners, or event handlers", () => {
		const registry = createPluginRegistry()
		createMemoryPlugin(makeMemoryService()).register(registry)

		expect(registry.plannerHintProviders).toHaveLength(0)
		expect(registry.taskRunners).toHaveLength(0)
		expect(registry.eventHandlers).toHaveLength(0)
	})
})

describe("memory context contributor", () => {
	it("returns undefined when profile is empty", async () => {
		const registry = createPluginRegistry()
		createMemoryPlugin(makeMemoryService()).register(registry)

		const contributor = registry.contextContributors[0]
		const result = await contributor?.contribute({
			userId: "user-1",
			conversationId: "conv-1",
			threadId: "thread-1",
		})
		expect(result).toBeUndefined()
	})

	it("returns formatted text when profile has memories", async () => {
		const memory = makeMemoryService({
			getProfile: () =>
				Effect.succeed({
					static: [{ id: "1", content: "User prefers TypeScript", category: "static" as const }],
					dynamic: [
						{ id: "2", content: "Working on billing module", category: "dynamic" as const },
					],
				}),
		})

		const registry = createPluginRegistry()
		createMemoryPlugin(memory).register(registry)

		const contributor = registry.contextContributors[0]
		const result = await contributor?.contribute({
			userId: "user-1",
			conversationId: "conv-1",
			threadId: "thread-1",
		})
		expect(result).toBeDefined()
		expect(result).toContain("User prefers TypeScript")
		expect(result).toContain("Working on billing module")
		expect(result).toContain("Known Facts")
		expect(result).toContain("Recent Context")
	})
})

describe("memory tool provider", () => {
	it("returns save_memory and search_memories tools", async () => {
		const registry = createPluginRegistry()
		createMemoryPlugin(makeMemoryService()).register(registry)

		const provider = registry.toolProviders[0]
		const tools = await provider?.getTools({
			userId: "user-1",
			conversationId: "conv-1",
			threadId: "thread-1",
		})
		expect(tools).toHaveProperty("save_memory")
		expect(tools).toHaveProperty("search_memories")
	})
})
