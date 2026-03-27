import { EnvService } from "@amby/env"
import { Context, Effect, Layer } from "effect"
import { createTelegramBotApiClient } from "./bot-api"
import { TELEGRAM_COMMANDS } from "./utils"

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
		const client = createTelegramBotApiClient({
			botToken: env.TELEGRAM_BOT_TOKEN,
			apiBaseUrl: env.TELEGRAM_API_BASE_URL,
		})

		yield* Effect.tryPromise(() =>
			client.setMyCommands(
				TELEGRAM_COMMANDS.map((command) => ({
					command: command.slice(1) as "start" | "stop" | "help",
					description:
						command === "/start"
							? "Start or resume the assistant"
							: command === "/stop"
								? "Pause the assistant"
								: "Show help",
				})),
			),
		)

		return {
			sendMessage: async (chatId: number, text: string) => {
				await client.sendMessage(chatId, text)
			},
			startTyping: async (chatId: number) => {
				await client.startTyping(chatId)
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
		const client = createTelegramBotApiClient({
			botToken: env.TELEGRAM_BOT_TOKEN,
			apiBaseUrl: env.TELEGRAM_API_BASE_URL,
		})
		return {
			sendMessage: async (chatId: number, text: string) => {
				await client.sendMessage(chatId, text)
			},
			startTyping: async (chatId: number) => {
				await client.startTyping(chatId)
			},
		}
	}),
)
