import type { AmbyPlugin, AutomationRepository, PluginRegistry } from "@amby/core"
import type { Database } from "@amby/db"
import { eq, schema } from "@amby/db"
import { resolveDeliveryTarget } from "./resolve-delivery-target"
import type { CronNextRunFn } from "./tools"
import { createAutomationTools } from "./tools"

export interface AutomationsPluginConfig {
	readonly automationRepo: AutomationRepository
	readonly db: Database
	readonly computeNextCronRun: CronNextRunFn
}

export function createAutomationsPlugin(config: AutomationsPluginConfig): AmbyPlugin {
	const { automationRepo, db, computeNextCronRun } = config

	return {
		id: "automations",

		register(registry: PluginRegistry) {
			registry.addToolProvider({
				id: "automations:tools",
				group: "automation",
				getTools: async ({ userId, conversationId }) => {
					const userRows = await db
						.select({ timezone: schema.users.timezone })
						.from(schema.users)
						.where(eq(schema.users.id, userId))
						.limit(1)
					const userTimezone = userRows[0]?.timezone ?? "UTC"

					const deliveryTarget = await resolveDeliveryTarget(db, userId, conversationId)

					return createAutomationTools({
						automationRepo,
						userId,
						userTimezone,
						computeNextCronRun,
						deliveryTarget,
					})
				},
			})

			registry.addPlannerHintProvider({
				id: "automations:hints",
				getHints: async () =>
					"The user can schedule reminders, recurring checks, and deferred actions. Use the schedule_automation tool for future-oriented requests.",
			})
		},
	}
}
