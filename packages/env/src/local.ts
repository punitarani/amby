import { DevTools } from "@effect/experimental"
import { Config, Effect, Layer, Redacted } from "effect"
import { DEFAULT_TELEGRAM_BOT_USERNAME, EnvService } from "./shared"

const EnvConfig = Config.all({
	NODE_ENV: Config.string("NODE_ENV").pipe(Config.withDefault("development")),
	API_URL: Config.string("API_URL").pipe(Config.withDefault("http://localhost:3001")),
	APP_URL: Config.string("APP_URL").pipe(Config.withDefault("http://localhost:3000")),
	CLOUDFLARE_AI_GATEWAY_BASE_URL: Config.string("CLOUDFLARE_AI_GATEWAY_BASE_URL").pipe(
		Config.withDefault(""),
	),
	CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: Config.redacted("CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN").pipe(
		Config.withDefault(Redacted.make("")),
	),
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
	TELEGRAM_BOT_USERNAME: Config.string("TELEGRAM_BOT_USERNAME").pipe(
		Config.withDefault(DEFAULT_TELEGRAM_BOT_USERNAME),
	),
	TELEGRAM_WEBHOOK_SECRET: Config.redacted("TELEGRAM_WEBHOOK_SECRET").pipe(
		Config.withDefault(Redacted.make("")),
	),
	COMPOSIO_API_KEY: Config.redacted("COMPOSIO_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
	COMPOSIO_WEBHOOK_SECRET: Config.redacted("COMPOSIO_WEBHOOK_SECRET").pipe(
		Config.withDefault(Redacted.make("")),
	),
	COMPOSIO_AUTH_CONFIG_GMAIL: Config.string("COMPOSIO_AUTH_CONFIG_GMAIL").pipe(
		Config.withDefault(""),
	),
	COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: Config.string("COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR").pipe(
		Config.withDefault(""),
	),
	COMPOSIO_AUTH_CONFIG_NOTION: Config.string("COMPOSIO_AUTH_CONFIG_NOTION").pipe(
		Config.withDefault(""),
	),
	COMPOSIO_AUTH_CONFIG_SLACK: Config.string("COMPOSIO_AUTH_CONFIG_SLACK").pipe(
		Config.withDefault(""),
	),
	COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: Config.string("COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE").pipe(
		Config.withDefault(""),
	),
	DATABASE_URL: Config.string("DATABASE_URL"),
	BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
	BETTER_AUTH_URL: Config.string("BETTER_AUTH_URL").pipe(
		Config.withDefault("http://localhost:3000"),
	),
	ENABLE_CUA: Config.boolean("ENABLE_CUA").pipe(Config.withDefault(false)),
	BRAINTRUST_API_KEY: Config.string("BRAINTRUST_API_KEY").pipe(Config.withDefault("")),
	BRAINTRUST_PROJECT_ID: Config.string("BRAINTRUST_PROJECT_ID").pipe(Config.withDefault("")),
	POSTHOG_KEY: Config.string("POSTHOG_KEY").pipe(Config.withDefault("")),
	POSTHOG_HOST: Config.string("POSTHOG_HOST").pipe(Config.withDefault("https://us.i.posthog.com")),
})

export const EnvServiceLive = Layer.effect(
	EnvService,
	Effect.gen(function* () {
		const raw = yield* EnvConfig
		return {
			NODE_ENV: raw.NODE_ENV,
			API_URL: raw.API_URL,
			APP_URL: raw.APP_URL,
			CLOUDFLARE_AI_GATEWAY_BASE_URL: raw.CLOUDFLARE_AI_GATEWAY_BASE_URL,
			CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: Redacted.value(raw.CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN),
			OPENROUTER_API_KEY: Redacted.value(raw.OPENROUTER_API_KEY),
			OPENAI_API_KEY: Redacted.value(raw.OPENAI_API_KEY),
			CARTESIA_API_KEY: Redacted.value(raw.CARTESIA_API_KEY),
			DAYTONA_API_KEY: Redacted.value(raw.DAYTONA_API_KEY),
			DAYTONA_API_URL: raw.DAYTONA_API_URL,
			DAYTONA_TARGET: raw.DAYTONA_TARGET,
			TELEGRAM_BOT_TOKEN: Redacted.value(raw.TELEGRAM_BOT_TOKEN),
			TELEGRAM_BOT_USERNAME: raw.TELEGRAM_BOT_USERNAME,
			TELEGRAM_WEBHOOK_SECRET: Redacted.value(raw.TELEGRAM_WEBHOOK_SECRET),
			COMPOSIO_API_KEY: Redacted.value(raw.COMPOSIO_API_KEY),
			COMPOSIO_WEBHOOK_SECRET: Redacted.value(raw.COMPOSIO_WEBHOOK_SECRET),
			COMPOSIO_AUTH_CONFIG_GMAIL: raw.COMPOSIO_AUTH_CONFIG_GMAIL,
			COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: raw.COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR,
			COMPOSIO_AUTH_CONFIG_NOTION: raw.COMPOSIO_AUTH_CONFIG_NOTION,
			COMPOSIO_AUTH_CONFIG_SLACK: raw.COMPOSIO_AUTH_CONFIG_SLACK,
			COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: raw.COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE,
			DATABASE_URL: raw.DATABASE_URL,
			BETTER_AUTH_SECRET: Redacted.value(raw.BETTER_AUTH_SECRET),
			BETTER_AUTH_URL: raw.BETTER_AUTH_URL,
			ENABLE_CUA: raw.ENABLE_CUA,
			BRAINTRUST_API_KEY: raw.BRAINTRUST_API_KEY,
			BRAINTRUST_PROJECT_ID: raw.BRAINTRUST_PROJECT_ID,
			POSTHOG_KEY: raw.POSTHOG_KEY,
			POSTHOG_HOST: raw.POSTHOG_HOST,
		}
	}),
)

const isEnabled = (value: string | undefined) => {
	const normalized = value?.trim().toLowerCase()
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

export const makeEffectDevToolsLive = () => {
	if (!isEnabled(process.env.EFFECT_DEVTOOLS)) {
		return Layer.empty
	}

	const url = process.env.EFFECT_DEVTOOLS_URL?.trim()
	return url ? DevTools.layer(url) : DevTools.layer()
}
