import { AuthServiceLive } from "@amby/auth"
import { makeBrowserServiceFromBindings } from "@amby/browser/workers"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import { ConnectorsServiceLive } from "@amby/connectors"
import { makeDbServiceFromHyperdrive } from "@amby/db"
import { makeEnvServiceFromBindings, type WorkerBindings } from "@amby/env/workers"
import { MemoryServiceLive } from "@amby/memory"
import { ModelServiceLive } from "@amby/models"
import { Layer, ManagedRuntime } from "effect"
import { TelegramSenderLite } from "../telegram"

const makeBaseLive = (bindings: WorkerBindings) => {
	const connectionString = bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? ""
	if (!connectionString) {
		console.error(
			"[Runtime] No database connection string — HYPERDRIVE and DATABASE_URL both missing",
		)
	}

	return Layer.mergeAll(
		MemoryServiceLive,
		ModelServiceLive,
		AuthServiceLive,
		TelegramSenderLite,
		ConnectorsServiceLive,
		makeBrowserServiceFromBindings(bindings),
	).pipe(
		Layer.provideMerge(SandboxServiceLive),
		Layer.provideMerge(makeDbServiceFromHyperdrive(connectionString)),
		Layer.provideMerge(makeEnvServiceFromBindings(bindings)),
	)
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
