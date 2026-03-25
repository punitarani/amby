import { ModelServiceLive } from "@amby/agent"
import { AuthServiceLive } from "@amby/auth"
import { BrowserServiceDisabledLive } from "@amby/browser/local"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import { CoreError, createPluginRegistry, PluginRegistryService, registerPlugins } from "@amby/core"
import { DbServiceLive } from "@amby/db"
import { EnvService } from "@amby/env"
import { EnvServiceLive, makeEffectDevToolsLive } from "@amby/env/local"
import { createMemoryPlugin, MemoryService, MemoryServiceLive } from "@amby/memory"
import {
	createAutomationsPlugin,
	createBrowserToolsPlugin,
	createComputerToolsPlugin,
} from "@amby/plugins"
import {
	buildSafeComposioRedirectUrl,
	ConnectorsService,
	ConnectorsServiceLive,
	createIntegrationsPlugin,
} from "@amby/plugins/integrations"
import { createSkillService, createSkillsPlugin } from "@amby/skills"
import type { Chat } from "chat"
import { Effect, Either, Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { createAmbyBot } from "./bot"
import { getHomeResponse } from "./home"
import { TelegramSenderLite } from "./telegram"

/**
 * Build the PluginRegistry Layer from resolved services.
 *
 * This is the composition root — it wires concrete service implementations
 * into the plugin registry that the agent consumes via PluginRegistryService.
 */
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

// Shared layers — constructed once at startup
// Layer order: infra (env, db) → services (memory, connectors, etc.) → PluginRegistry (depends on services)
const InfraLive = Layer.mergeAll(makeEffectDevToolsLive(), SandboxServiceLive).pipe(
	Layer.provideMerge(DbServiceLive),
	Layer.provideMerge(EnvServiceLive),
)

const ServicesLive = Layer.mergeAll(
	MemoryServiceLive,
	TaskSupervisorLive,
	ModelServiceLive,
	AuthServiceLive,
	ConnectorsServiceLive,
	BrowserServiceDisabledLive,
).pipe(Layer.provideMerge(InfraLive))

const SharedLive = PluginRegistryLive.pipe(Layer.provideMerge(ServicesLive))

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

// OAuth callback proxy
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

			yield* Effect.tryPromise(() =>
				fetch(
					`${env.TELEGRAM_API_BASE_URL || "https://api.telegram.org"}/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							commands: [
								{ command: "start", description: "Start or resume the assistant" },
								{ command: "stop", description: "Pause the assistant" },
								{ command: "help", description: "Show help" },
							],
						}),
					},
				),
			)

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
