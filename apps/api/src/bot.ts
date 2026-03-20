import { AgentService, makeAgentServiceLive } from "@amby/agent"
import { DbService, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { createMemoryState } from "@chat-adapter/state-memory"
import { createTelegramAdapter } from "@chat-adapter/telegram"
import { Chat } from "chat"
import { Effect, type ManagedRuntime } from "effect"
import { getPostHogClient } from "./posthog"
import { findOrCreateUser, type TelegramFrom } from "./telegram/utils"

// biome-ignore lint/suspicious/noExplicitAny: Runtime type is complex; correctness verified at the call site
export function createAmbyBot(runtime: ManagedRuntime.ManagedRuntime<any, any>, botToken: string) {
	const telegram = createTelegramAdapter({ botToken, mode: "auto" })
	const bot = new Chat({
		userName: "amby",
		adapters: { telegram },
		state: createMemoryState(),
	})

	// Shared handler for both new mentions (first message) and subscribed threads
	const handle = async (
		thread: Parameters<Parameters<typeof bot.onNewMention>[0]>[0],
		message: Parameters<Parameters<typeof bot.onNewMention>[0]>[1],
	) => {
		const raw = message.raw as { from?: TelegramFrom; chat: { id: number }; [key: string]: unknown }
		const from = raw.from
		const chatId = raw.chat.id
		const text = message.text

		if (!from) return

		// Handle commands
		if (text && ["/start", "/stop", "/help"].includes(text)) {
			const effect = Effect.gen(function* () {
				const env = yield* EnvService
				const userId = yield* findOrCreateUser(from, chatId)
				const posthog = getPostHogClient(env.POSTHOG_KEY, env.POSTHOG_HOST)

				switch (text) {
					case "/start": {
						const { db } = yield* DbService
						yield* Effect.tryPromise(async () =>
							db.transaction(async (tx) => {
								const existing = await tx
									.select({ id: schema.conversations.id })
									.from(schema.conversations)
									.where(eq(schema.conversations.userId, userId))
									.limit(1)
								if (existing[0]) return
								await tx.insert(schema.conversations).values({ userId, channelType: "telegram" })
							}),
						)
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
						break
					}
					case "/stop":
						posthog.capture({
							distinctId: userId,
							event: "bot_stopped",
							properties: { channel: "telegram" },
						})
						break
					case "/help":
						posthog.capture({
							distinctId: userId,
							event: "help_requested",
							properties: { channel: "telegram" },
						})
						break
				}
			})

			await runtime.runPromise(effect)

			const responses: Record<string, string> = {
				"/start": `Welcome to Amby, ${from.first_name}! I'm your personal ambient assistant. Just send me a message and I'll help you out.`,
				"/stop": "Paused. Send /start to resume.",
				"/help":
					"Available commands:\n/start — Start or resume the assistant\n/stop — Pause the assistant\n/help — Show this help message\n\nOr just send me any text message!",
			}

			await thread.post(responses[text] as string)
			return
		}

		if (!text) return

		await thread.startTyping()

		const effect = Effect.gen(function* () {
			const userId = yield* findOrCreateUser(from, chatId)
			const sendReply = (t: string) => thread.post(t).then(() => {})

			const response = yield* Effect.gen(function* () {
				const agent = yield* AgentService
				const conversationId = yield* agent.ensureConversation("telegram")
				return yield* agent.handleMessage(conversationId, text, { telegram: raw }, sendReply)
			}).pipe(Effect.provide(makeAgentServiceLive(userId)))

			if (response.trim()) {
				yield* Effect.tryPromise(() => thread.post(response))
			}
		}).pipe(
			Effect.catchAllCause((cause) =>
				Effect.gen(function* () {
					console.error("Chat handler error:", cause)
					yield* Effect.tryPromise(() =>
						thread.post("Sorry, something went wrong. Please try again."),
					).pipe(Effect.catchAll(() => Effect.void))
				}),
			),
		)

		await runtime.runPromise(effect)
	}

	bot.onNewMention(async (thread, message) => {
		await thread.subscribe()
		await handle(thread, message)
	})

	bot.onSubscribedMessage(async (thread, message) => {
		if (message.author.isMe) return
		await handle(thread, message)
	})

	return bot
}
