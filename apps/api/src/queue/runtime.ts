import { AuthServiceLive } from "@amby/auth"
import { SandboxServiceLive } from "@amby/computer"
import { makeDbServiceFromUrl } from "@amby/db"
import { makeEnvServiceFromBindings, type WorkerBindings } from "@amby/env/workers"
import { MemoryServiceLive } from "@amby/memory"
import { ModelServiceLive } from "@amby/models"
import { Layer, ManagedRuntime } from "effect"
import { TelegramBotLite } from "../telegram"

/** Build a per-request Effect runtime from Worker env bindings (reusable by queue consumer and workflows) */
export const makeRuntimeForConsumer = (bindings: WorkerBindings) => {
	const dbUrl = bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? ""

	const SharedLive = Layer.mergeAll(
		MemoryServiceLive,
		SandboxServiceLive,
		ModelServiceLive,
		AuthServiceLive,
		TelegramBotLite,
	).pipe(
		Layer.provideMerge(makeDbServiceFromUrl(dbUrl)),
		Layer.provideMerge(makeEnvServiceFromBindings(bindings)),
	)

	return ManagedRuntime.make(SharedLive)
}
