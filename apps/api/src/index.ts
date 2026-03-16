import { AgentService, makeAgentServiceLive } from "@amby/agent"
import { AuthServiceLive } from "@amby/auth"
import { SandboxServiceLive } from "@amby/computer"
import { DbServiceLive } from "@amby/db"
import { EnvService } from "@amby/env"
import { EnvServiceLive } from "@amby/env/local"
import { MemoryServiceLive } from "@amby/memory"
import { ModelServiceLive } from "@amby/models"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { TelegramBot, TelegramBotLive } from "./telegram"
import { findOrCreateUser, handleCommand, verifySecret } from "./telegram/utils"

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

// Local dev: telegram webhook processes synchronously (no queues/DO/workflows)
app.post("/telegram/webhook", async (c) => {
	const headerSecret = c.req.header("X-Telegram-Bot-Api-Secret-Token")
	const env = await runtime.runPromise(Effect.map(EnvService, (e) => e))

	if (!verifySecret(headerSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
		return c.json({ error: "Unauthorized" }, 401)
	}

	const update = await c.req.json()
	const message = update?.message
	const from = message?.from
	const text = message?.text
	const chatId = message?.chat?.id

	if (!from || !chatId) return c.json({ ok: true })

	if (["/start", "/stop", "/help"].includes(text ?? "")) {
		await runtime.runPromise(handleCommand(text, from, chatId))
		return c.json({ ok: true })
	}

	if (!text) return c.json({ ok: true })

	const effect = Effect.gen(function* () {
		const bot = yield* TelegramBot
		const userId = yield* findOrCreateUser(from, chatId)

		yield* Effect.tryPromise(() => bot.api.sendChatAction(chatId, "typing"))

		const response = yield* Effect.gen(function* () {
			const agent = yield* AgentService
			const conversationId = yield* agent.ensureConversation("telegram")
			return yield* agent.handleMessage(conversationId, text, { telegram: message })
		}).pipe(Effect.provide(makeAgentServiceLive(userId)))

		yield* Effect.tryPromise(() => bot.api.sendMessage(chatId, response))
	}).pipe(
		Effect.catchAllCause((cause) =>
			Effect.gen(function* () {
				const bot = yield* TelegramBot
				console.error("Telegram webhook error:", cause)
				yield* Effect.tryPromise(() =>
					bot.api.sendMessage(chatId, "Sorry, something went wrong. Please try again."),
				).pipe(Effect.catchAll(() => Effect.void))
			}),
		),
	)

	await runtime.runPromise(effect)
	return c.json({ ok: true })
})

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
