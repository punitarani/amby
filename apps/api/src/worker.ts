import { AuthServiceLive } from "@amby/auth"
import { SandboxServiceLive } from "@amby/computer"
import { makeDbServiceFromUrl } from "@amby/db"
import { makeEnvServiceFromBindings, type WorkerBindings } from "@amby/env/workers"
import { MemoryServiceLive } from "@amby/memory"
import { ModelServiceLive } from "@amby/models"
import { Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { handleTelegramWebhook, TelegramBotLite } from "./telegram"

type Env = { Bindings: WorkerBindings }

const app = new Hono<Env>()

app.get("/health", (c) => c.json({ status: "ok" }))

/** Build a per-request Effect runtime from Worker env bindings */
const makeRuntime = (bindings: WorkerBindings) => {
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

app.post("/telegram/webhook", async (c) => {
	const runtime = makeRuntime(c.env)
	try {
		return await handleTelegramWebhook(runtime, c)
	} finally {
		await runtime.dispose()
	}
})

export default app
