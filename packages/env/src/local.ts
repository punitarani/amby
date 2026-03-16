import { Config, Effect, Layer, Redacted } from "effect"
import { EnvService } from "./shared"

const EnvConfig = Config.all({
	NODE_ENV: Config.string("NODE_ENV").pipe(Config.withDefault("development")),
	OPENROUTER_API_KEY: Config.redacted("OPENROUTER_API_KEY"),
	OPENAI_API_KEY: Config.redacted("OPENAI_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
	CARTESIA_API_KEY: Config.redacted("CARTESIA_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
	DAYTONA_API_KEY: Config.redacted("DAYTONA_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
	DAYTONA_API_URL: Config.string("DAYTONA_API_URL").pipe(
		Config.withDefault("https://app.daytona.io/api"),
	),
	DAYTONA_TARGET: Config.string("DAYTONA_TARGET").pipe(Config.withDefault("us")),
	TELEGRAM_BOT_TOKEN: Config.redacted("TELEGRAM_BOT_TOKEN").pipe(
		Config.withDefault(Redacted.make("")),
	),
	TELEGRAM_WEBHOOK_SECRET: Config.redacted("TELEGRAM_WEBHOOK_SECRET").pipe(
		Config.withDefault(Redacted.make("")),
	),
	DATABASE_URL: Config.string("DATABASE_URL"),
	BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
	BETTER_AUTH_URL: Config.string("BETTER_AUTH_URL").pipe(
		Config.withDefault("http://localhost:3000"),
	),
	ENABLE_CUA: Config.boolean("ENABLE_CUA").pipe(Config.withDefault(false)),
	POSTHOG_KEY: Config.string("POSTHOG_KEY").pipe(Config.withDefault("")),
	POSTHOG_HOST: Config.string("POSTHOG_HOST").pipe(Config.withDefault("https://us.i.posthog.com")),
})

export const EnvServiceLive = Layer.effect(
	EnvService,
	Effect.gen(function* () {
		const raw = yield* EnvConfig
		return {
			NODE_ENV: raw.NODE_ENV,
			OPENROUTER_API_KEY: Redacted.value(raw.OPENROUTER_API_KEY),
			OPENAI_API_KEY: Redacted.value(raw.OPENAI_API_KEY),
			CARTESIA_API_KEY: Redacted.value(raw.CARTESIA_API_KEY),
			DAYTONA_API_KEY: Redacted.value(raw.DAYTONA_API_KEY),
			DAYTONA_API_URL: raw.DAYTONA_API_URL,
			DAYTONA_TARGET: raw.DAYTONA_TARGET,
			TELEGRAM_BOT_TOKEN: Redacted.value(raw.TELEGRAM_BOT_TOKEN),
			TELEGRAM_WEBHOOK_SECRET: Redacted.value(raw.TELEGRAM_WEBHOOK_SECRET),
			DATABASE_URL: raw.DATABASE_URL,
			BETTER_AUTH_SECRET: Redacted.value(raw.BETTER_AUTH_SECRET),
			BETTER_AUTH_URL: raw.BETTER_AUTH_URL,
			ENABLE_CUA: raw.ENABLE_CUA,
			POSTHOG_KEY: raw.POSTHOG_KEY,
			POSTHOG_HOST: raw.POSTHOG_HOST,
		}
	}),
)
