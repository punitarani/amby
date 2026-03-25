import { ModelServiceLive } from "@amby/agent"
import { AuthServiceLive } from "@amby/auth"
import { BrowserServiceDisabledLive } from "@amby/browser/local"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import {
	buildSafeComposioRedirectUrl,
	ConnectorsService,
	ConnectorsServiceLive,
} from "@amby/connectors"
import { DbServiceLive } from "@amby/db"
import { EnvService } from "@amby/env"
import { EnvServiceLive, makeEffectDevToolsLive } from "@amby/env/local"
import { MemoryServiceLive } from "@amby/memory"
import type { Chat } from "chat"
import { Effect, Either, Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { createAmbyBot } from "./bot"
import { getHomeResponse } from "./home"
import { TelegramSenderLite } from "./telegram"

// Shared layers — constructed once at startup
const SharedLive = Layer.mergeAll(
	makeEffectDevToolsLive(),
	MemoryServiceLive,
	TaskSupervisorLive,
	ModelServiceLive,
	AuthServiceLive,
	ConnectorsServiceLive,
	BrowserServiceDisabledLive,
).pipe(
	Layer.provideMerge(SandboxServiceLive),
	Layer.provideMerge(DbServiceLive),
	Layer.provideMerge(EnvServiceLive),
)

const runtime = ManagedRuntime.make(SharedLive)

const app = new Hono()

app.get("/", (c) => c.json(getHomeResponse()))
app.get("/health", (c) => c.json({ status: "ok" }))

// White-label connect link — resolves UUID to the underlying Composio auth URL
app.get("/link/:id", async (c) => {
	const result = await runtime.runPromise(
		Effect.gen(function* () {
			const connectors = yield* ConnectorsService
			return yield* connectors.resolveConnectLink(c.req.param("id"))
		}).pipe(Effect.either),
	)
	const url = Either.isRight(result) ? result.right : undefined
	return url ? c.redirect(url, 302) : c.notFound()
})

// OAuth callback proxy — same as Cloudflare Worker; local dev uses ngrok/API_URL for OAuth redirect URIs
app.get("/composio/redirect", (c) => {
	return c.redirect(buildSafeComposioRedirectUrl(c.req.url), 302)
})

const port = Number(process.env.PORT) || 3001

let chatBot: Chat | null = null

console.log("Starting Amby API...")

runtime
	.runPromise(
		Effect.gen(function* () {
			const env = yield* EnvService

			if (!env.TELEGRAM_BOT_TOKEN) {
				console.log("Telegram bot: not configured (TELEGRAM_BOT_TOKEN not set)")
				return
			}

			const botRuntime = ManagedRuntime.make(
				TelegramSenderLite.pipe(Layer.provideMerge(SharedLive)),
			)

			// Register bot commands via Telegram API
			yield* Effect.tryPromise(() =>
				fetch(`${env.TELEGRAM_API_BASE_URL || "https://api.telegram.org"}/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
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
			const bot = createAmbyBot(botRuntime, env.TELEGRAM_BOT_TOKEN)
			chatBot = bot
			yield* Effect.tryPromise(() => bot.initialize())

			console.log("Telegram bot: configured and running")
		}),
	)
	.then(() => {
		console.log(`Amby API listening on port ${port}`)
	})

// Webhook endpoint for local dev mock Telegram channel
app.post("/telegram/webhook", async (c) => {
	if (!chatBot) {
		return c.json({ error: "Bot not initialized" }, 503)
	}
	const handler = chatBot.webhooks.telegram
	if (!handler) {
		return c.json({ error: "Telegram adapter not available" }, 500)
	}
	return handler(c.req.raw, { waitUntil: () => {} })
})

export default {
	port,
	fetch: app.fetch,
}
