import type { AmbyPlugin, PluginRegistry } from "@amby/core"
import type { Context } from "effect"
import type { ConnectorsService } from "./service"
import { createConnectorManagementTools } from "./tools"

export type IntegrationsPluginConfig = {
	readonly connectors: Context.Tag.Service<typeof ConnectorsService>
	readonly userId: string
}

export function createIntegrationsPlugin(config: IntegrationsPluginConfig): AmbyPlugin {
	const { connectors, userId } = config

	return {
		id: "integrations",
		register(registry: PluginRegistry) {
			registry.addToolProvider({
				id: "integrations:management",
				group: "integration",
				async getTools() {
					return createConnectorManagementTools(connectors, userId)
				},
			})

			registry.addToolProvider({
				id: "integrations:external",
				group: "integration",
				async getTools() {
					if (!connectors.isEnabled()) return {}
					const tools = await import("effect").then(({ Effect }) =>
						Effect.runPromise(connectors.getAgentTools(userId)),
					)
					return tools ?? {}
				},
			})

			registry.addPlannerHintProvider({
				id: "integrations:hints",
				async getHints() {
					if (!connectors.isEnabled()) return undefined
					return "Integration specialist: can perform actions through connected third-party apps (Gmail, Google Calendar, Notion, Slack, Google Drive)."
				},
			})
		},
	}
}
