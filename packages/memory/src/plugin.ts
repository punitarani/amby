import type { AmbyPlugin, PluginRegistry } from "@amby/core"
import type { Context } from "effect"
import { Effect } from "effect"
import { buildMemoriesText, deduplicateMemories } from "./prompt-builder"
import type { MemoryService } from "./repository"
import { createMemoryTools } from "./tools"

type MemoryOps = Context.Tag.Service<typeof MemoryService>

/**
 * Create the memory plugin from a resolved MemoryService instance.
 *
 * This is the authoritative memory plugin — the duplicate in
 * @amby/plugins/memory has been deleted.
 */
export function createMemoryPlugin(memory: MemoryOps): AmbyPlugin {
	return {
		id: "memory",

		register(registry: PluginRegistry) {
			registry.addContextContributor({
				id: "memory:profile",
				contribute: async ({ userId }) => {
					const profile = await Effect.runPromise(memory.getProfile(userId))
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
				getTools: async ({ userId }) => createMemoryTools(memory, userId),
			})
		},
	}
}
