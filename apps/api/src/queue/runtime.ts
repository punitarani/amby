import { ModelServiceLive } from "@amby/agent"
import { AuthServiceLive } from "@amby/auth"
import { makeBrowserServiceFromBindings } from "@amby/browser/workers"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import { makeDbServiceFromHyperdrive } from "@amby/db"
import { makeEnvServiceFromBindings, type WorkerBindings } from "@amby/env/workers"
import { MemoryServiceLive } from "@amby/memory"
import { ConnectorsServiceLive } from "@amby/plugins/integrations"
import { Layer, ManagedRuntime } from "effect"
import { PluginRegistryLive } from "../shared/plugin-registry"
import { TelegramSenderLite } from "../telegram"

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
