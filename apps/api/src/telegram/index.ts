import { timingSafeEqual } from "node:crypto"
import { AgentService, makeAgentServiceLive } from "@amby/agent"
import { and, DbService, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { Context, Effect, Layer } from "effect"
import { Bot } from "grammy"
import type { Context as HonoContext } from "hono"
import { Hono } from "hono"
import { getPostHogClient } from "../posthog"

interface TelegramFrom {
	id: number
	first_name: string
	last_name?: string
	username?: string
	language_code?: string
	is_premium?: boolean
}

interface TelegramMessage {
	message_id: number
	text?: string
	chat: { id: number; type: string; first_name?: string; last_name?: string; username?: string }
	from?: TelegramFrom
	date: number
	entities?: unknown[]
}

interface TelegramUpdate {
	update_id: number
	message?: TelegramMessage
}

// biome-ignore lint/suspicious/noExplicitAny: ManagedRuntime generic is complex and not relevant here
type Runtime = import("effect").ManagedRuntime.ManagedRuntime<any, any>

// --- TelegramBot Effect Service ---

export class TelegramBot extends Context.Tag("TelegramBot")<TelegramBot, Bot>() {}

export const TelegramBotLive = Layer.effect(
	TelegramBot,
	Effect.gen(function* () {
		const env = yield* EnvService
		if (!env.TELEGRAM_BOT_TOKEN) {
			throw new Error("TELEGRAM_BOT_TOKEN is not set")
		}
		const bot = new Bot(env.TELEGRAM_BOT_TOKEN)

		yield* Effect.tryPromise(() =>
			bot.api.setMyCommands([
				{ command: "start", description: "Start or resume the assistant" },
				{ command: "stop", description: "Pause the assistant" },
				{ command: "help", description: "Show help" },
			]),
		)

		return bot
	}),
)

/** Lightweight TelegramBot layer that skips setMyCommands — suitable for per-request use in Workers */
export const TelegramBotLite = Layer.effect(
	TelegramBot,
	Effect.gen(function* () {
		const env = yield* EnvService
		if (!env.TELEGRAM_BOT_TOKEN) {
			throw new Error("TELEGRAM_BOT_TOKEN is not set")
		}
		return new Bot(env.TELEGRAM_BOT_TOKEN)
	}),
)

// --- Helpers ---

const buildProfileMetadata = (from: TelegramFrom, chatId: number): Record<string, unknown> => ({
	chatId,
	username: from.username ?? null,
	firstName: from.first_name,
	lastName: from.last_name ?? null,
	languageCode: from.language_code ?? null,
	isPremium: from.is_premium ?? false,
})

/**
 * Find or create a user linked to a Telegram account.
 * Uses a transaction to avoid race conditions on concurrent messages.
 * Stores/updates profile metadata on the account row.
 */
const findOrCreateUser = (from: TelegramFrom, chatId: number) =>
	Effect.gen(function* () {
		const { db } = yield* DbService
		const metadata = buildProfileMetadata(from, chatId)

		return yield* Effect.tryPromise(async () => {
			return await db.transaction(async (tx) => {
				const existing = await tx
					.select({ userId: schema.accounts.userId, id: schema.accounts.id })
					.from(schema.accounts)
					.where(
						and(
							eq(schema.accounts.providerId, "telegram"),
							eq(schema.accounts.accountId, String(from.id)),
						),
					)
					.limit(1)

				if (existing[0]) {
					// Update metadata with latest profile info on every message
					await tx
						.update(schema.accounts)
						.set({ metadata, updatedAt: new Date() })
						.where(eq(schema.accounts.id, existing[0].id))
					return existing[0].userId
				}

				// Create new user + account link atomically
				const userId = crypto.randomUUID()
				const name = [from.first_name, from.last_name].filter(Boolean).join(" ")

				await tx.insert(schema.users).values({ id: userId, name })
				await tx.insert(schema.accounts).values({
					id: crypto.randomUUID(),
					userId,
					accountId: String(from.id),
					providerId: "telegram",
					metadata,
				})

				return userId
			})
		})
	})

const verifySecret = (headerSecret: string | undefined, configuredSecret: string): boolean => {
	if (!headerSecret || !configuredSecret) return false
	try {
		const a = Buffer.from(headerSecret, "utf-8")
		const b = Buffer.from(configuredSecret, "utf-8")
		if (a.length !== b.length) return false
		return timingSafeEqual(a, b)
	} catch {
		return false
	}
}

// --- Shared webhook handler ---

export const handleTelegramWebhook = async (runtime: Runtime, c: HonoContext) => {
	const headerSecret = c.req.header("X-Telegram-Bot-Api-Secret-Token")
	const env = await runtime.runPromise(Effect.map(EnvService, (e) => e))

	if (!verifySecret(headerSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
		return c.json({ error: "Unauthorized" }, 401)
	}

	const posthog = getPostHogClient(env.POSTHOG_KEY, env.POSTHOG_HOST)

	const update: TelegramUpdate = await c.req.json()
	const message = update?.message
	const from = message?.from
	const text = message?.text
	const chatId = message?.chat?.id

	if (!from || !chatId) {
		return c.json({ ok: true })
	}

	const effect = Effect.gen(function* () {
		const bot = yield* TelegramBot

		// Handle /start
		if (text === "/start") {
			const userId = yield* findOrCreateUser(from, chatId)

			yield* Effect.gen(function* () {
				const agent = yield* AgentService
				yield* agent.ensureConversation("telegram")
			}).pipe(Effect.provide(makeAgentServiceLive(userId)))

			posthog.capture({
				distinctId: userId,
				event: "bot_started",
				properties: {
					channel: "telegram",
					username: from.username ?? null,
					language_code: from.language_code ?? null,
					is_premium: from.is_premium ?? false,
				},
			})

			yield* Effect.tryPromise(() =>
				bot.api.sendMessage(
					chatId,
					`Welcome to Amby, ${from.first_name}! I'm your personal ambient assistant. Just send me a message and I'll help you out.`,
				),
			)
			return
		}

		// Handle /stop
		if (text === "/stop") {
			const userId = yield* findOrCreateUser(from, chatId)
			posthog.capture({
				distinctId: userId,
				event: "bot_stopped",
				properties: { channel: "telegram" },
			})
			yield* Effect.tryPromise(() => bot.api.sendMessage(chatId, "Paused. Send /start to resume."))
			return
		}

		// Handle /help
		if (text === "/help") {
			const userId = yield* findOrCreateUser(from, chatId)
			posthog.capture({
				distinctId: userId,
				event: "help_requested",
				properties: { channel: "telegram" },
			})
			yield* Effect.tryPromise(() =>
				bot.api.sendMessage(
					chatId,
					"Available commands:\n/start — Start or resume the assistant\n/stop — Pause the assistant\n/help — Show this help message\n\nOr just send me any text message!",
				),
			)
			return
		}

		// Regular text messages -> agent
		if (!text) return

		const userId = yield* findOrCreateUser(from, chatId)

		posthog.capture({
			distinctId: userId,
			event: "message_sent",
			properties: {
				channel: "telegram",
				message_length: text.length,
			},
		})

		const response = yield* Effect.gen(function* () {
			const agent = yield* AgentService
			const conversationId = yield* agent.ensureConversation("telegram")
			// Pass raw Telegram message as metadata for zero data loss
			const messageMetadata = message ? { telegram: message } : undefined
			return yield* agent.handleMessage(conversationId, text, messageMetadata)
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
	// Always return ok to prevent Telegram retries
	return c.json({ ok: true })
}

// --- Router ---

export const createTelegramRouter = (runtime: Runtime) => {
	const router = new Hono()
	router.post("/webhook", (c) => handleTelegramWebhook(runtime, c))
	return router
}
