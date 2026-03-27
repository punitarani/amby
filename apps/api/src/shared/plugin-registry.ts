import { CoreError, createPluginRegistry, PluginRegistryService, registerPlugins } from "@amby/core"
import { DbService } from "@amby/db"
import {
	AutomationService,
	adaptAutomationService,
	computeNextCronRun,
	createAutomationsPlugin,
	createBrowserToolsPlugin,
	createComputerToolsPlugin,
} from "@amby/plugins"
import { ConnectorsService, createIntegrationsPlugin } from "@amby/plugins/integrations"
import { createMemoryPlugin, MemoryService } from "@amby/plugins/memory"
import { createSkillService, createSkillsPlugin } from "@amby/skills"
import { Effect, Layer } from "effect"

/**
 * Build the PluginRegistry Layer from resolved services.
 *
 * This is the composition root — it wires concrete service implementations
 * into the plugin registry that the agent consumes via PluginRegistryService.
 */
export const PluginRegistryLive = Layer.effect(
	PluginRegistryService,
	Effect.gen(function* () {
		const memory = yield* MemoryService
		const connectors = yield* ConnectorsService
		const automationSvc = yield* AutomationService
		const { db } = yield* DbService

		const registry = createPluginRegistry()

		const skillService = createSkillService({ skillsDir: "./skills" })

		const notAvailable = new CoreError({ message: "not available" })

		const automationRepo = adaptAutomationService(automationSvc)

		registerPlugins(registry, [
			createMemoryPlugin(memory),
			createIntegrationsPlugin({ connectors }),
			createAutomationsPlugin({
				automationRepo,
				db,
				computeNextCronRun,
			}),
			createBrowserToolsPlugin({
				browserProvider: {
					execute: () => Effect.fail(notAvailable),
					isAvailable: () => Effect.succeed(false),
				},
			}),
			createComputerToolsPlugin({
				computerProvider: {
					startTask: () => Effect.fail(notAvailable),
					queryTask: () => Effect.fail(notAvailable),
					isAvailable: () => Effect.succeed(false),
				},
			}),
			createSkillsPlugin(skillService),
		])

		return registry
	}),
)
