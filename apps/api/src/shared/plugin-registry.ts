import { CoreError, createPluginRegistry, PluginRegistryService, registerPlugins } from "@amby/core"
import { createMemoryPlugin, MemoryService } from "@amby/memory"
import {
	createAutomationsPlugin,
	createBrowserToolsPlugin,
	createComputerToolsPlugin,
} from "@amby/plugins"
import { ConnectorsService, createIntegrationsPlugin } from "@amby/plugins/integrations"
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

		const registry = createPluginRegistry()

		const skillService = createSkillService({ skillsDir: "./skills" })

		const notAvailable = new CoreError({ message: "not available" })

		registerPlugins(registry, [
			createMemoryPlugin(memory),
			createIntegrationsPlugin({ connectors }),
			createAutomationsPlugin({
				automationRepo: {
					create: () => Effect.fail(notAvailable),
					findById: () => Effect.void.pipe(Effect.as(undefined)),
					findByUser: () => Effect.succeed([]),
					findDue: () => Effect.succeed([]),
					updateStatus: () => Effect.void,
					delete: () => Effect.void,
				},
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
