import type { AmbyPlugin, AutomationRepository, PluginRegistry } from "@amby/core"
import { createAutomationTools } from "./tools"

export interface AutomationsPluginConfig {
	readonly automationRepo: AutomationRepository
}

export function createAutomationsPlugin(config: AutomationsPluginConfig): AmbyPlugin {
	const { automationRepo } = config

	return {
		id: "automations",

		register(registry: PluginRegistry) {
			registry.addToolProvider({
				id: "automations:tools",
				group: "automation",
				getTools: async ({ userId }) => createAutomationTools({ automationRepo, userId }),
			})

			registry.addPlannerHintProvider({
				id: "automations:hints",
				getHints: async () =>
					"The user can schedule reminders, recurring checks, and deferred actions. Use the schedule_automation tool for future-oriented requests.",
			})
		},
	}
}
