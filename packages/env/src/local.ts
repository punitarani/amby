import { DevTools } from "@effect/experimental"
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { DEFAULT_TELEGRAM_BOT_USERNAME, EnvService } from "./shared"

const EnvConfig = Config.all({
	// Environment
	NODE_ENV: Config.string("NODE_ENV").pipe(Config.withDefault("development")),
	API_URL: Config.string("API_URL").pipe(Config.withDefault("http://localhost:3001")),
	APP_URL: Config.string("APP_URL").pipe(Config.withDefault("http://localhost:3000")),

	// Database
	DATABASE_URL: Config.string("DATABASE_URL"),

	// Auth — BetterAuth
	BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
	BETTER_AUTH_URL: Config.string("BETTER_AUTH_URL").pipe(
		Config.withDefault("http://localhost:3001"),
	),

	// LLM, STT, TTS
	OPENROUTER_API_KEY: Config.redacted("OPENROUTER_API_KEY"),
	OPENAI_API_KEY: Config.redacted("OPENAI_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
	CARTESIA_API_KEY: Config.redacted("CARTESIA_API_KEY").pipe(Config.withDefault(Redacted.make(""))),

	// Cloudflare AI Gateway
	CLOUDFLARE_AI_GATEWAY_BASE_URL: Config.string("CLOUDFLARE_AI_GATEWAY_BASE_URL").pipe(
		Config.withDefault(""),
	),
	CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: Config.redacted("CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN").pipe(
		Config.withDefault(Redacted.make("")),
	),

	// Attachments
	ATTACHMENTS_SIGNING_SECRET: Config.redacted("ATTACHMENTS_SIGNING_SECRET").pipe(
		Config.withDefault(Redacted.make("dev-attachments-secret")),
	),

	// Telegram
	TELEGRAM_BOT_TOKEN: Config.redacted("TELEGRAM_BOT_TOKEN").pipe(
		Config.withDefault(Redacted.make("")),
	),
	TELEGRAM_BOT_USERNAME: Config.string("TELEGRAM_BOT_USERNAME").pipe(
		Config.withDefault(DEFAULT_TELEGRAM_BOT_USERNAME),
	),
	TELEGRAM_WEBHOOK_SECRET: Config.redacted("TELEGRAM_WEBHOOK_SECRET").pipe(
		Config.withDefault(Redacted.make("")),
	),
	TELEGRAM_API_BASE_URL: Config.string("TELEGRAM_API_BASE_URL").pipe(Config.option),
	TELEGRAM_LOGIN_WIDGET_ENABLED: Config.boolean("TELEGRAM_LOGIN_WIDGET_ENABLED").pipe(
		Config.withDefault(true),
	),
	TELEGRAM_MINI_APP_ENABLED: Config.boolean("TELEGRAM_MINI_APP_ENABLED").pipe(
		Config.withDefault(false),
	),
	TELEGRAM_OIDC_CLIENT_ID: Config.string("TELEGRAM_OIDC_CLIENT_ID").pipe(Config.withDefault("")),
	TELEGRAM_OIDC_CLIENT_SECRET: Config.redacted("TELEGRAM_OIDC_CLIENT_SECRET").pipe(
		Config.withDefault(Redacted.make("")),
	),
	TELEGRAM_OIDC_REQUEST_PHONE: Config.boolean("TELEGRAM_OIDC_REQUEST_PHONE").pipe(
		Config.withDefault(false),
	),
	TELEGRAM_OIDC_REQUEST_BOT_ACCESS: Config.boolean("TELEGRAM_OIDC_REQUEST_BOT_ACCESS").pipe(
		Config.withDefault(false),
	),
	TELEGRAM_MAX_AUTH_AGE_SECONDS: Config.integer("TELEGRAM_MAX_AUTH_AGE_SECONDS").pipe(
		Config.withDefault(86400),
	),

	// Daytona Sandbox
	DAYTONA_API_KEY: Config.redacted("DAYTONA_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
	DAYTONA_API_URL: Config.string("DAYTONA_API_URL").pipe(
		Config.withDefault("https://app.daytona.io/api"),
	),
	DAYTONA_TARGET: Config.string("DAYTONA_TARGET").pipe(Config.withDefault("us")),

	// Computer / Sandbox
	ENABLE_CUA: Config.boolean("ENABLE_CUA").pipe(Config.withDefault(false)),

	// Composio connectors
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

	// Braintrust — agent observability & tracing
	BRAINTRUST_API_KEY: Config.string("BRAINTRUST_API_KEY").pipe(Config.withDefault("")),
	BRAINTRUST_PROJECT_ID: Config.string("BRAINTRUST_PROJECT_ID").pipe(Config.withDefault("")),

	// PostHog analytics
	POSTHOG_KEY: Config.string("POSTHOG_KEY").pipe(Config.withDefault("")),
	POSTHOG_HOST: Config.string("POSTHOG_HOST").pipe(Config.withDefault("https://us.i.posthog.com")),
})

export const EnvServiceLive = Layer.effect(
	EnvService,
	Effect.gen(function* () {
		const raw = yield* EnvConfig
		return {
			// Environment
			NODE_ENV: raw.NODE_ENV,
			API_URL: raw.API_URL,
			APP_URL: raw.APP_URL,

			// Database
			DATABASE_URL: raw.DATABASE_URL,

			// Auth — BetterAuth
			BETTER_AUTH_SECRET: Redacted.value(raw.BETTER_AUTH_SECRET),
			BETTER_AUTH_URL: raw.BETTER_AUTH_URL,

			// LLM, STT, TTS
			OPENROUTER_API_KEY: Redacted.value(raw.OPENROUTER_API_KEY),
			OPENAI_API_KEY: Redacted.value(raw.OPENAI_API_KEY),
			CARTESIA_API_KEY: Redacted.value(raw.CARTESIA_API_KEY),

			// Cloudflare AI Gateway
			CLOUDFLARE_AI_GATEWAY_BASE_URL: raw.CLOUDFLARE_AI_GATEWAY_BASE_URL,
			CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: Redacted.value(raw.CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN),

			// Attachments
			ATTACHMENTS_SIGNING_SECRET: Redacted.value(raw.ATTACHMENTS_SIGNING_SECRET),

			// Telegram
			TELEGRAM_BOT_TOKEN: Redacted.value(raw.TELEGRAM_BOT_TOKEN),
			TELEGRAM_BOT_USERNAME: raw.TELEGRAM_BOT_USERNAME,
			TELEGRAM_WEBHOOK_SECRET: Redacted.value(raw.TELEGRAM_WEBHOOK_SECRET),
			TELEGRAM_API_BASE_URL: Option.getOrUndefined(raw.TELEGRAM_API_BASE_URL),
			TELEGRAM_LOGIN_WIDGET_ENABLED: raw.TELEGRAM_LOGIN_WIDGET_ENABLED,
			TELEGRAM_MINI_APP_ENABLED: raw.TELEGRAM_MINI_APP_ENABLED,
			TELEGRAM_OIDC_CLIENT_ID: raw.TELEGRAM_OIDC_CLIENT_ID,
			TELEGRAM_OIDC_CLIENT_SECRET: Redacted.value(raw.TELEGRAM_OIDC_CLIENT_SECRET),
			TELEGRAM_OIDC_REQUEST_PHONE: raw.TELEGRAM_OIDC_REQUEST_PHONE,
			TELEGRAM_OIDC_REQUEST_BOT_ACCESS: raw.TELEGRAM_OIDC_REQUEST_BOT_ACCESS,
			TELEGRAM_MAX_AUTH_AGE_SECONDS: raw.TELEGRAM_MAX_AUTH_AGE_SECONDS,

			// Daytona Sandbox
			DAYTONA_API_KEY: Redacted.value(raw.DAYTONA_API_KEY),
			DAYTONA_API_URL: raw.DAYTONA_API_URL,
			DAYTONA_TARGET: raw.DAYTONA_TARGET,

			// Computer / Sandbox
			ENABLE_CUA: raw.ENABLE_CUA,

			// Composio connectors
			COMPOSIO_API_KEY: Redacted.value(raw.COMPOSIO_API_KEY),
			COMPOSIO_WEBHOOK_SECRET: Redacted.value(raw.COMPOSIO_WEBHOOK_SECRET),
			COMPOSIO_AUTH_CONFIG_GMAIL: raw.COMPOSIO_AUTH_CONFIG_GMAIL,
			COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: raw.COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR,
			COMPOSIO_AUTH_CONFIG_NOTION: raw.COMPOSIO_AUTH_CONFIG_NOTION,
			COMPOSIO_AUTH_CONFIG_SLACK: raw.COMPOSIO_AUTH_CONFIG_SLACK,
			COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: raw.COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE,

			// Braintrust — agent observability & tracing
			BRAINTRUST_API_KEY: raw.BRAINTRUST_API_KEY,
			BRAINTRUST_PROJECT_ID: raw.BRAINTRUST_PROJECT_ID,

			// PostHog analytics
			POSTHOG_KEY: raw.POSTHOG_KEY,
			POSTHOG_HOST: raw.POSTHOG_HOST,
		}
	}),
)

const isEnabled = (value: string | undefined) => {
	const normalized = value?.trim().toLowerCase()
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

export const makeEffectDevToolsLive = (): Layer.Layer<never> => {
	if (!isEnabled(process.env.EFFECT_DEVTOOLS)) {
		return Layer.empty
	}

	const url = process.env.EFFECT_DEVTOOLS_URL?.trim()
	return url ? DevTools.layer(url) : DevTools.layer()
}
