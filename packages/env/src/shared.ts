import { Context, Data } from "effect"

export class EnvError extends Data.TaggedError("EnvError")<{
	readonly message: string
}> {}

export interface Env {
	readonly NODE_ENV: string
	readonly APP_URL: string
	readonly OPENROUTER_API_KEY: string
	readonly OPENAI_API_KEY: string
	readonly CARTESIA_API_KEY: string
	readonly DAYTONA_API_KEY: string
	readonly DAYTONA_API_URL: string
	readonly DAYTONA_TARGET: string
	readonly TELEGRAM_BOT_TOKEN: string
	readonly TELEGRAM_BOT_USERNAME: string
	readonly TELEGRAM_WEBHOOK_SECRET: string
	readonly COMPOSIO_API_KEY: string
	readonly COMPOSIO_WEBHOOK_SECRET: string
	readonly COMPOSIO_AUTH_CONFIG_GMAIL: string
	readonly COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: string
	readonly COMPOSIO_AUTH_CONFIG_NOTION: string
	readonly COMPOSIO_AUTH_CONFIG_SLACK: string
	readonly COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: string
	readonly DATABASE_URL: string
	readonly BETTER_AUTH_SECRET: string
	readonly BETTER_AUTH_URL: string
	readonly ENABLE_CUA: boolean
	readonly BRAINTRUST_API_KEY: string
	readonly BRAINTRUST_PROJECT_ID: string
	readonly POSTHOG_KEY: string
	readonly POSTHOG_HOST: string
}

export const DEFAULT_TELEGRAM_BOT_USERNAME = "my_amby_bot"

export class EnvService extends Context.Tag("EnvService")<EnvService, Env>() {}
