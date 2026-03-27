import type { PluginRegistry } from "@amby/core"
import type { ToolSet } from "ai"
import type { ToolGroups } from "../execution/registry"

/**
 * Resolve tool groups from the plugin registry.
 *
 * Each tool provider is mapped to its declared group. The agent's
 * specialist registry uses these groups to select which tools are
 * visible to each specialist.
 */
export async function resolveToolGroupsFromRegistry(
	registry: PluginRegistry,
	userId: string,
	conversationId: string,
	threadId: string,
): Promise<ToolGroups> {
	const groups: ToolGroups = {}
	const context = { userId, conversationId, threadId }
	for (const provider of registry.toolProviders) {
		try {
			const tools = await provider.getTools(context)
			if (tools && Object.keys(tools).length > 0) {
				const group = provider.group as keyof ToolGroups
				groups[group] = { ...(groups[group] ?? {}), ...tools } as ToolSet
			}
		} catch (err) {
			console.warn(
				`[agent] Tool provider "${provider.id}" (group: ${provider.group}) failed, skipping:`,
				err instanceof Error ? err.message : String(err),
			)
		}
	}
	return groups
}
