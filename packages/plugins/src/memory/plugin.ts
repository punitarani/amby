import type { AmbyPlugin, MemoryRepository, PluginRegistry } from "@amby/core"
import { Effect } from "effect"
import { buildMemoriesText, deduplicateMemories } from "./prompt-builder"
import { createMemoryTools } from "./tools"

export interface MemoryPluginConfig {
	readonly memoryRepo: MemoryRepository
}

export function createMemoryPlugin(config: MemoryPluginConfig): AmbyPlugin {
	const { memoryRepo } = config

	return {
		id: "memory",

		register(registry: PluginRegistry) {
			registry.addContextContributor({
				id: "memory:profile",
				contribute: async ({ userId }) => {
					const profile = await Effect.runPromise(memoryRepo.getProfile(userId))
					if (profile.static.length === 0 && profile.dynamic.length === 0) {
						return undefined
					}
					const deduped = deduplicateMemories(profile.static, profile.dynamic)
					return buildMemoriesText(deduped)
				},
			})

			registry.addToolProvider({
				id: "memory:tools",
				group: "memory",
				getTools: async ({ userId }) => createMemoryTools(memoryRepo, userId),
			})
		},
	}
}
