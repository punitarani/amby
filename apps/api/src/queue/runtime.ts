import { ModelServiceLive } from "@amby/agent"
import { makeAttachmentServicesFromBindings } from "@amby/attachments/workers"
import { AuthLive } from "@amby/auth"
import { makeBrowserServiceFromBindings } from "@amby/browser/workers"
import { TelegramReplySenderLive, TelegramSenderLite } from "@amby/channels"
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
import * as Sentry from "@sentry/cloudflare"
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
	const AttachmentLive = makeAttachmentServicesFromBindings(bindings).pipe(
		Layer.provideMerge(InfraLive),
	)

	const ServicesLive = Layer.mergeAll(
		MemoryServiceLive,
		AutomationServiceLive,
		ModelServiceLive,
		AuthLive,
		TelegramSenderLite,
		TelegramReplySenderLive,
		ConnectorsServiceLive,
		makeBrowserServiceFromBindings(bindings, {
			logger: (entry) => {
				const level = (entry.level ?? 1) <= 0 ? "warn" : "info"
				Sentry.logger[level](`[BrowserService] ${entry.message}`, entry)
			},
		}),
	).pipe(Layer.provideMerge(InfraLive), Layer.provideMerge(AttachmentLive))

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
