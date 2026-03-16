import { EnvService } from "@amby/env"
import { Context, Effect, Layer } from "effect"
import { Bot } from "grammy"

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
