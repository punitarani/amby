import type {
	AmbyPlugin,
	IntegrationProvider,
	IntegrationRepository,
	PluginRegistry,
} from "@amby/core"
import { createIntegrationTools } from "./tools"

export interface IntegrationsPluginConfig {
	readonly integrationRepo: IntegrationRepository
	readonly connectProvider?: (
		userId: string,
		provider: IntegrationProvider,
	) => Promise<{ redirectUrl: string; messages: string[] }>
	readonly disconnectProvider?: (
		userId: string,
		provider: IntegrationProvider,
		accountId?: string,
	) => Promise<{ disconnected: boolean }>
	/**
	 * Get the external tool set for a user (e.g. from Composio).
	 * The composition root provides this.
	 */
	readonly getExternalTools?: (userId: string) => Promise<Record<string, unknown> | undefined>
}

export function createIntegrationsPlugin(config: IntegrationsPluginConfig): AmbyPlugin {
	const { integrationRepo, connectProvider, disconnectProvider, getExternalTools } = config

	return {
		id: "integrations",

		register(registry: PluginRegistry) {
			registry.addToolProvider({
				id: "integrations:management",
				group: "integration",
				getTools: async ({ userId }) =>
					createIntegrationTools({
						integrationRepo,
						userId,
						connectProvider,
						disconnectProvider,
					}),
			})

			if (getExternalTools) {
				registry.addToolProvider({
					id: "integrations:external",
					group: "integration",
					getTools: async ({ userId }) => {
						const tools = await getExternalTools(userId)
						return tools ?? {}
					},
				})
			}
		},
	}
}
