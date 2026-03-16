import { AgentService, makeAgentServiceLive } from "@amby/agent"
import { and, DbService, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { Effect, type ManagedRuntime } from "effect"
import { Bot } from "grammy"
import { Hono } from "hono"

interface TelegramFrom {
	id: number
	first_name: string
	last_name?: string
	username?: string
}

interface TelegramUpdate {
	message?: {
		text?: string
		chat: { id: number }
		from?: TelegramFrom
	}
}

// biome-ignore lint/suspicious/noExplicitAny: ManagedRuntime generic is complex and not relevant here
type Runtime = ManagedRuntime.ManagedRuntime<any, any>

let bot: Bot | null = null

const getBot = (runtime: Runtime) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const env = yield* EnvService
			if (!env.TELEGRAM_BOT_TOKEN) {
				throw new Error("TELEGRAM_BOT_TOKEN is not set")
			}
			if (!bot) {
				bot = new Bot(env.TELEGRAM_BOT_TOKEN)
			}
			return bot
		}),
	)

/**
 * Find or create a user linked to a Telegram account.
 * Uses the existing `accounts` table with providerId="telegram".
 */
const findOrCreateUser = (from: TelegramFrom) =>
	Effect.gen(function* () {
		const { query } = yield* DbService

		// Look up existing account link
		const existing = yield* query((db) =>
			db
				.select({ userId: schema.accounts.userId })
				.from(schema.accounts)
				.where(
					and(
						eq(schema.accounts.providerId, "telegram"),
						eq(schema.accounts.accountId, String(from.id)),
					),
				)
				.limit(1),
		)

		if (existing[0]) {
			return existing[0].userId
		}

		// Create new user
		const userId = crypto.randomUUID()
		const name = [from.first_name, from.last_name].filter(Boolean).join(" ")

		yield* query((db) =>
			db.insert(schema.users).values({
				id: userId,
				name,
			}),
		)

		// Link Telegram account
		yield* query((db) =>
			db.insert(schema.accounts).values({
				id: crypto.randomUUID(),
				userId,
				accountId: String(from.id),
				providerId: "telegram",
			}),
		)

		return userId
	})

export const createTelegramRouter = (runtime: Runtime) => {
	const router = new Hono()

	router.post("/webhook", async (c) => {
		// Verify the static webhook secret
		const headerSecret = c.req.header("X-Telegram-Bot-Api-Secret-Token")
		const configuredSecret = await runtime.runPromise(
			Effect.map(EnvService, (env) => env.TELEGRAM_WEBHOOK_SECRET),
		)

		if (!configuredSecret || !headerSecret || headerSecret !== configuredSecret) {
			return c.json({ error: "Unauthorized" }, 401)
		}

		const update: TelegramUpdate = await c.req.json()
		const from = update?.message?.from
		const text = update?.message?.text
		const chatId = update?.message?.chat?.id

		if (!from || !chatId) {
			return c.json({ ok: true })
		}

		const telegramBot = await getBot(runtime)

		// Handle /start — auto-register and welcome
		if (text === "/start") {
			const userId = await runtime.runPromise(findOrCreateUser(from))

			// Ensure a conversation exists so subsequent messages work immediately
			await runtime.runPromise(
				Effect.gen(function* () {
					const agent = yield* AgentService
					yield* agent.ensureConversation("telegram")
				}).pipe(Effect.provide(makeAgentServiceLive(userId))),
			)

			const name = from.first_name
			await telegramBot.api.sendMessage(
				chatId,
				`Welcome to Amby, ${name}! 👋\n\nI'm your personal ambient assistant. Just send me a message and I'll help you out.`,
			)
			return c.json({ ok: true })
		}

		// For all other messages, the user must already exist
		if (!text) {
			return c.json({ ok: true })
		}

		const userId = await runtime.runPromise(findOrCreateUser(from))

		const response = await runtime.runPromise(
			Effect.gen(function* () {
				const agent = yield* AgentService
				const conversationId = yield* agent.ensureConversation("telegram")
				return yield* agent.handleMessage(conversationId, text)
			}).pipe(Effect.provide(makeAgentServiceLive(userId))),
		)

		await telegramBot.api.sendMessage(chatId, response)
		return c.json({ ok: true })
	})

	return router
}
