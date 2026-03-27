import { EnvService } from "@amby/env"
import { Context, Effect, Layer } from "effect"
import { createTelegramAdapter } from "./adapter"
import { escapeTelegramHtml, telegramHtml } from "./html-format"

// --- TelegramSender Effect Service ---

export class TelegramSender extends Context.Tag("TelegramSender")<
	TelegramSender,
	{
		sendMessage(chatId: number, text: string): Promise<void>
		startTyping(chatId: number): Promise<void>
	}
>() {}

export const TelegramSenderLive = Layer.effect(
	TelegramSender,
	Effect.gen(function* () {
		const env = yield* EnvService
		if (!env.TELEGRAM_BOT_TOKEN) {
			throw new Error("TELEGRAM_BOT_TOKEN is not set")
		}
		const adapter = createTelegramAdapter({
			botToken: env.TELEGRAM_BOT_TOKEN,
			apiBaseUrl: env.TELEGRAM_API_BASE_URL,
			mode: "webhook",
		})

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

		return {
			sendMessage: async (chatId: number, text: string) => {
				await adapter.postMessage(String(chatId), telegramHtml(escapeTelegramHtml(text)))
			},
			startTyping: async (chatId: number) => {
				await adapter.startTyping(String(chatId))
			},
		}
	}),
)

/** Lightweight TelegramSender layer that skips setMyCommands — suitable for per-request use in Workers */
export const TelegramSenderLite = Layer.effect(
	TelegramSender,
	Effect.gen(function* () {
		const env = yield* EnvService
		if (!env.TELEGRAM_BOT_TOKEN) {
			throw new Error("TELEGRAM_BOT_TOKEN is not set")
		}
		const adapter = createTelegramAdapter({
			botToken: env.TELEGRAM_BOT_TOKEN,
			apiBaseUrl: env.TELEGRAM_API_BASE_URL,
			mode: "webhook",
		})
		return {
			sendMessage: async (chatId: number, text: string) => {
				await adapter.postMessage(String(chatId), telegramHtml(escapeTelegramHtml(text)))
			},
			startTyping: async (chatId: number) => {
				await adapter.startTyping(String(chatId))
			},
		}
	}),
)
