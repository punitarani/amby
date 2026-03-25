import { ModelServiceLive } from "@amby/agent"
import { AuthServiceLive } from "@amby/auth"
import { makeBrowserServiceFromBindings } from "@amby/browser/workers"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import { CoreError, createPluginRegistry, PluginRegistryService, registerPlugins } from "@amby/core"
import { makeDbServiceFromHyperdrive } from "@amby/db"
import { makeEnvServiceFromBindings, type WorkerBindings } from "@amby/env/workers"
import { createMemoryPlugin, MemoryService, MemoryServiceLive } from "@amby/memory"
import {
	createAutomationsPlugin,
	createBrowserToolsPlugin,
	createComputerToolsPlugin,
} from "@amby/plugins"
import {
	ConnectorsService,
	ConnectorsServiceLive,
	createIntegrationsPlugin,
} from "@amby/plugins/integrations"
import { createSkillService, createSkillsPlugin } from "@amby/skills"
import { Effect, Layer, ManagedRuntime } from "effect"
import { TelegramSenderLite } from "../telegram"

const PluginRegistryLive = Layer.effect(
	PluginRegistryService,
	Effect.gen(function* () {
		const memory = yield* MemoryService
		const connectors = yield* ConnectorsService
		const registry = createPluginRegistry()
		const skillService = createSkillService({ skillsDir: "./skills" })

		const notAvailable = new CoreError({ message: "not available" })

		registerPlugins(registry, [
			createMemoryPlugin(memory),
			createIntegrationsPlugin({ connectors, userId: "" }),
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

const makeBaseLive = (bindings: WorkerBindings) => {
	const connectionString = bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? ""
	if (!connectionString) {
		console.error(
			"[Runtime] No database connection string — HYPERDRIVE and DATABASE_URL both missing",
		)
	}

	const InfraLive = Layer.mergeAll(SandboxServiceLive).pipe(
		Layer.provideMerge(makeDbServiceFromHyperdrive(connectionString)),
		Layer.provideMerge(makeEnvServiceFromBindings(bindings)),
	)

	const ServicesLive = Layer.mergeAll(
		MemoryServiceLive,
		ModelServiceLive,
		AuthServiceLive,
		TelegramSenderLite,
		ConnectorsServiceLive,
		makeBrowserServiceFromBindings(bindings),
	).pipe(Layer.provideMerge(InfraLive))

	return PluginRegistryLive.pipe(Layer.provideMerge(ServicesLive))
}

/** Lightweight runtime for queue consumers and workflows that don't need TaskSupervisor */
export const makeRuntimeForConsumer = (bindings: WorkerBindings) =>
	ManagedRuntime.make(makeBaseLive(bindings))

/** Runtime that includes TaskSupervisor — use only for agent execution contexts.
 *  The supervisor's heartbeat interval is cleaned up automatically on dispose(). */
export const makeAgentRuntimeForConsumer = (bindings: WorkerBindings) => {
	const base = makeBaseLive(bindings)
	return ManagedRuntime.make(TaskSupervisorLive.pipe(Layer.provideMerge(base)))
}
