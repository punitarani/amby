import { AuthServiceLive } from "@amby/auth"
import { SandboxServiceLive } from "@amby/computer"
import { DbServiceLive } from "@amby/db"
import { EnvService } from "@amby/env"
import { EnvServiceLive } from "@amby/env/local"
import { MemoryServiceLive } from "@amby/memory"
import { ModelServiceLive } from "@amby/models"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { createTelegramRouter, TelegramBotLive } from "./telegram"

// Shared layers — constructed once at startup
const SharedLive = Layer.mergeAll(
	MemoryServiceLive,
	SandboxServiceLive,
	ModelServiceLive,
	AuthServiceLive,
	TelegramBotLive,
).pipe(Layer.provideMerge(DbServiceLive), Layer.provideMerge(EnvServiceLive))

const runtime = ManagedRuntime.make(SharedLive)

const app = new Hono()

app.get("/health", (c) => c.json({ status: "ok" }))

app.route("/telegram", createTelegramRouter(runtime))

// Start the server
const port = Number(process.env.PORT) || 3001

console.log("Starting Amby API...")

runtime
	.runPromise(
		Effect.gen(function* () {
			const env = yield* EnvService
			console.log(`Telegram bot: ${env.TELEGRAM_BOT_TOKEN ? "configured" : "not configured"}`)
			console.log(
				`Telegram webhook secret: ${env.TELEGRAM_WEBHOOK_SECRET ? "configured" : "not configured"}`,
			)
		}),
	)
	.then(() => {
		console.log(`Amby API listening on port ${port}`)
	})

export default {
	port,
	fetch: app.fetch,
}
