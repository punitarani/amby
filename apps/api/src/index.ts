import { AuthServiceLive } from "@amby/auth"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import { DbServiceLive } from "@amby/db"
import { EnvService } from "@amby/env"
import { EnvServiceLive } from "@amby/env/local"
import { MemoryServiceLive } from "@amby/memory"
import { ModelServiceLive } from "@amby/models"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { createAmbyBot } from "./bot"
import { homeResponse } from "./home"

// Shared layers — constructed once at startup
const SharedLive = Layer.mergeAll(
	MemoryServiceLive,
	TaskSupervisorLive,
	ModelServiceLive,
	AuthServiceLive,
).pipe(
	Layer.provideMerge(SandboxServiceLive),
	Layer.provideMerge(DbServiceLive),
	Layer.provideMerge(EnvServiceLive),
)

const runtime = ManagedRuntime.make(SharedLive)

const app = new Hono()

app.get("/", (c) => c.json(homeResponse))
app.get("/health", (c) => c.json({ status: "ok" }))

const port = Number(process.env.PORT) || 3001

console.log("Starting Amby API...")

runtime
	.runPromise(
		Effect.gen(function* () {
			const env = yield* EnvService

			if (!env.TELEGRAM_BOT_TOKEN) {
				console.log("Telegram bot: not configured (TELEGRAM_BOT_TOKEN not set)")
				return
			}

			// Register bot commands via Telegram API
			yield* Effect.tryPromise(() =>
				fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						commands: [
							{ command: "start", description: "Start or resume the assistant" },
							{ command: "stop", description: "Pause the assistant" },
							{ command: "help", description: "Show help" },
						],
					}),
				}),
			)

			// Initialize Chat SDK bot (auto mode: polling in dev, webhook when deployed)
			const bot = createAmbyBot(runtime, env.TELEGRAM_BOT_TOKEN)
			yield* Effect.tryPromise(() => bot.initialize())

			console.log("Telegram bot: configured and running")
		}),
	)
	.then(() => {
		console.log(`Amby API listening on port ${port}`)
	})

export default {
	port,
	fetch: app.fetch,
}
