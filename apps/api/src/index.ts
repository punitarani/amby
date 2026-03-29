import { ModelServiceLive } from "@amby/agent"
import { AttachmentService } from "@amby/attachments"
import { makeAttachmentServicesLocal } from "@amby/attachments/local"
import { AuthLive, AuthService, resolveAuthCorsOrigin } from "@amby/auth"
import { BrowserServiceDisabledLive } from "@amby/browser/local"
import { createAmbyBot, TelegramReplySenderLive, TelegramSenderLite } from "@amby/channels"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import {
	CodexAuthStoreLive,
	ComputeStoreLive,
	DbServiceLive,
	TaskStoreLive,
	TraceStoreLive,
	VaultStoreLive,
} from "@amby/db"
import { EnvService } from "@amby/env"
import { EnvServiceLive, makeEffectDevToolsLive } from "@amby/env/local"
import { AutomationServiceLive } from "@amby/plugins"
import {
	buildSafeComposioRedirectUrl,
	ConnectorsService,
	ConnectorsServiceLive,
} from "@amby/plugins/integrations"
import { MemoryServiceLive } from "@amby/plugins/memory"
import { PluginRegistryLive } from "@amby/plugins/registry"
import { CodexVaultServiceLive, VaultServiceLive } from "@amby/vault"
import { Effect, Either, Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { getHomeResponse } from "./home"

// Shared layers — constructed once at startup
// Layer order: infra (env, db) → services (memory, connectors, etc.) → PluginRegistry (depends on services)
const StoreLive = Layer.mergeAll(
	TaskStoreLive,
	TraceStoreLive,
	ComputeStoreLive,
	VaultStoreLive,
	CodexAuthStoreLive,
).pipe(Layer.provideMerge(DbServiceLive))

const InfraLive = Layer.mergeAll(makeEffectDevToolsLive(), SandboxServiceLive).pipe(
	Layer.provideMerge(StoreLive),
	Layer.provideMerge(EnvServiceLive),
)
const AttachmentLive = makeAttachmentServicesLocal().pipe(Layer.provideMerge(InfraLive))

const VaultLive = CodexVaultServiceLive.pipe(
	Layer.provideMerge(VaultServiceLive),
	Layer.provideMerge(InfraLive),
)

const ServicesLive = Layer.mergeAll(
	MemoryServiceLive,
	AutomationServiceLive,
	TaskSupervisorLive,
	ModelServiceLive,
	AuthLive,
	ConnectorsServiceLive,
	BrowserServiceDisabledLive,
	TelegramReplySenderLive,
).pipe(Layer.provideMerge(VaultLive), Layer.provideMerge(AttachmentLive))

const SharedLive = PluginRegistryLive.pipe(Layer.provideMerge(ServicesLive))

const runtime = ManagedRuntime.make(SharedLive)

const app = new Hono()

const localAuthEnv = {
	NODE_ENV: process.env.NODE_ENV ?? "development",
	APP_URL: process.env.APP_URL ?? "http://localhost:3000",
	API_URL: process.env.API_URL ?? "http://localhost:3001",
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
}

app.use(
	"/api/auth/*",
	cors({
		origin: (origin) => resolveAuthCorsOrigin(origin, localAuthEnv),
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		exposeHeaders: ["Set-Cookie"],
		credentials: true,
	}),
)

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
	const auth = await runtime.runPromise(AuthService)
	return auth.handler(c.req.raw)
})

app.get("/", (c) => c.json(getHomeResponse()))
app.get("/health", (c) => c.json({ status: "ok" }))

app.get("/attachments/:id", async (c) => {
	const result = await runtime.runPromise(
		Effect.gen(function* () {
			const attachments = yield* AttachmentService
			yield* attachments.verifySignedDownload({
				attachmentId: c.req.param("id"),
				expires: c.req.query("expires") ?? "",
				signature: c.req.query("sig") ?? "",
			})
			return yield* attachments.getDownloadResponse(c.req.param("id"))
		}).pipe(Effect.either),
	)
	return Either.isRight(result) ? result.right : c.json({ error: "Unauthorized" }, 401)
})

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

let chatBot: ReturnType<typeof createAmbyBot> | null = null

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
	return handler(c.req.raw, {
		waitUntil: (p: Promise<unknown>) => {
			p.catch((err) => console.error("[waitUntil]", err))
		},
	})
})

export default {
	port,
	fetch: app.fetch,
}
