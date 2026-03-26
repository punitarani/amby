import { AgentService, makeAgentServiceLive } from "@amby/agent"
import { createMemoryState } from "@chat-adapter/state-memory"
import { createTelegramAdapter } from "@chat-adapter/telegram"
import { Chat } from "chat"
import { Effect, type ManagedRuntime } from "effect"
import {
	findOrCreateUser,
	handleCommand,
	parseTelegramCommand,
	type TelegramFrom,
} from "./telegram/utils"

// biome-ignore lint/suspicious/noExplicitAny: Runtime type is complex; correctness verified at the call site
export function createAmbyBot(runtime: ManagedRuntime.ManagedRuntime<any, any>, botToken: string) {
	// Use webhook mode when TELEGRAM_API_BASE_URL is set (mock channel or custom endpoint).
	// Otherwise use auto (which defaults to polling for local dev with real Telegram).
	const mode = process.env.TELEGRAM_API_BASE_URL ? "webhook" : "auto"
	const telegram = createTelegramAdapter({
		botToken,
		apiBaseUrl: process.env.TELEGRAM_API_BASE_URL,
		mode,
	})
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
		const parsedCommand = parseTelegramCommand(text, process.env.TELEGRAM_BOT_USERNAME)

		if (!from) return

		if (parsedCommand) {
			await runtime.runPromise(handleCommand(parsedCommand, from, chatId))
			return
		}

		if (!text) return

		await thread.startTyping()

		const effect = Effect.gen(function* () {
			const userId = yield* findOrCreateUser(from, chatId)
			const sendReply = (t: string) => thread.post(t).then(() => {})

			const response = yield* Effect.gen(function* () {
				const agent = yield* AgentService
				const conversationId = yield* agent.ensureConversation("telegram", String(chatId))
				return yield* agent.handleMessage(conversationId, text, { telegram: raw }, sendReply)
			}).pipe(Effect.provide(makeAgentServiceLive(userId)))

			if (response.userResponse.text.trim()) {
				yield* Effect.tryPromise(() => thread.post(response.userResponse.text))
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
