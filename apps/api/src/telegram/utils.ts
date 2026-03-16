import { timingSafeEqual } from "node:crypto"
import { AgentService, makeAgentServiceLive } from "@amby/agent"
import { SandboxService } from "@amby/computer"
import { and, DbService, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { Effect } from "effect"
import { getPostHogClient } from "../posthog"
import { TelegramBot } from "./index"

// --- Types ---

export interface TelegramFrom {
	id: number
	first_name: string
	last_name?: string
	username?: string
	language_code?: string
	is_premium?: boolean
}

export interface TelegramMessage {
	message_id: number
	text?: string
	chat: { id: number; type: string; first_name?: string; last_name?: string; username?: string }
	from?: TelegramFrom
	date: number
	entities?: unknown[]
}

export interface TelegramUpdate {
	update_id: number
	message?: TelegramMessage
}

export interface TelegramQueueMessage {
	update: TelegramUpdate
	receivedAt: number
}

export interface BufferedMessage {
	text: string
	messageId: number
	date: number
}

// --- Utilities ---

export const verifySecret = (
	headerSecret: string | undefined,
	configuredSecret: string,
): boolean => {
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

export const buildProfileMetadata = (
	from: TelegramFrom,
	chatId: number,
): Record<string, unknown> => ({
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
export const findOrCreateUser = (from: TelegramFrom, chatId: number) =>
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
					await tx
						.update(schema.accounts)
						.set({ metadata, updatedAt: new Date() })
						.where(eq(schema.accounts.id, existing[0].id))
					return existing[0].userId
				}

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

/**
 * Handle simple stateless commands (/start, /stop, /help) inline.
 * Returns an Effect that sends the appropriate response via the Telegram Bot API.
 */
export const handleCommand = (
	command: string,
	from: TelegramFrom,
	chatId: number,
	options?: { waitUntil?: (promise: Promise<unknown>) => void },
) =>
	Effect.gen(function* () {
		const bot = yield* TelegramBot
		const env = yield* EnvService
		const userId = yield* findOrCreateUser(from, chatId)
		const posthog = getPostHogClient(env.POSTHOG_KEY, env.POSTHOG_HOST)

		switch (command) {
			case "/start": {
				yield* Effect.gen(function* () {
					const agent = yield* AgentService
					yield* agent.ensureConversation("telegram")
				}).pipe(Effect.provide(makeAgentServiceLive(userId)))

				// Fire-and-forget: pre-provision sandbox so it's ready when needed
				const sandboxService = yield* SandboxService
				if (sandboxService.enabled) {
					const provisionPromise = Effect.runPromise(sandboxService.provision(userId)).catch(
						(err) => console.error("[Sandbox] Pre-provision failed:", err),
					)
					if (options?.waitUntil) {
						options.waitUntil(provisionPromise)
					}
				}

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
				break
			}

			case "/stop": {
				posthog.capture({
					distinctId: userId,
					event: "bot_stopped",
					properties: { channel: "telegram" },
				})
				yield* Effect.tryPromise(() =>
					bot.api.sendMessage(chatId, "Paused. Send /start to resume."),
				)
				break
			}

			case "/help": {
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
				break
			}
		}
	})

/** Split a long message into chunks that fit within Telegram's 4096-char limit. */
export const splitTelegramMessage = (text: string, maxLength = 4096): string[] => {
	if (text.length <= maxLength) return [text]

	const chunks: string[] = []
	let remaining = text

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining)
			break
		}

		// Try to split at a newline near the limit
		let splitIndex = remaining.lastIndexOf("\n", maxLength)
		if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
			// Fall back to splitting at a space
			splitIndex = remaining.lastIndexOf(" ", maxLength)
		}
		if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
			// Hard split at the limit
			splitIndex = maxLength
		}

		chunks.push(remaining.slice(0, splitIndex))
		remaining = remaining.slice(splitIndex).trimStart()
	}

	return chunks
}
