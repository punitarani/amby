import { ModelServiceLive } from "@amby/agent"
import { AuthServiceLive } from "@amby/auth"
import { makeBrowserServiceFromBindings } from "@amby/browser/workers"
import { TelegramSenderLite } from "@amby/channels"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import {
	ComputeStoreLive,
	makeDbServiceFromHyperdrive,
	TaskStoreLive,
	TraceStoreLive,
} from "@amby/db"
import { makeEnvServiceFromBindings, type WorkerBindings } from "@amby/env/workers"
import { AutomationServiceLive } from "@amby/plugins"
import { ConnectorsServiceLive } from "@amby/plugins/integrations"
import { MemoryServiceLive } from "@amby/plugins/memory"
import { PluginRegistryLive } from "@amby/plugins/registry"
import { Layer, ManagedRuntime } from "effect"

const makeBaseLive = (bindings: WorkerBindings) => {
	const connectionString = bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? ""
	if (!connectionString) {
		console.error(
			"[Runtime] No database connection string — HYPERDRIVE and DATABASE_URL both missing",
		)
	}

	const DbLive = makeDbServiceFromHyperdrive(connectionString)
	const StoreLive = Layer.mergeAll(TaskStoreLive, TraceStoreLive, ComputeStoreLive).pipe(
		Layer.provideMerge(DbLive),
	)

	const InfraLive = Layer.mergeAll(SandboxServiceLive).pipe(
		Layer.provideMerge(StoreLive),
		Layer.provideMerge(makeEnvServiceFromBindings(bindings)),
	)

	const ServicesLive = Layer.mergeAll(
		MemoryServiceLive,
		AutomationServiceLive,
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
