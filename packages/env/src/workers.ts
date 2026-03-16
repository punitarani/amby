import { Layer } from "effect"
import { EnvService } from "./shared"

export interface WorkerBindings {
	NODE_ENV?: string
	OPENROUTER_API_KEY: string
	OPENAI_API_KEY?: string
	CARTESIA_API_KEY?: string
	DAYTONA_API_KEY?: string
	DAYTONA_API_URL?: string
	DAYTONA_TARGET?: string
	TELEGRAM_BOT_TOKEN?: string
	TELEGRAM_WEBHOOK_SECRET?: string
	DATABASE_URL?: string
	BETTER_AUTH_SECRET: string
	BETTER_AUTH_URL?: string
	ENABLE_CUA?: string
	HYPERDRIVE?: { connectionString: string }
	POSTHOG_KEY?: string
	POSTHOG_HOST?: string
}

export const makeEnvServiceFromBindings = (bindings: WorkerBindings) =>
	Layer.succeed(EnvService, {
		NODE_ENV: bindings.NODE_ENV ?? "production",
		OPENROUTER_API_KEY: bindings.OPENROUTER_API_KEY,
		OPENAI_API_KEY: bindings.OPENAI_API_KEY ?? "",
		CARTESIA_API_KEY: bindings.CARTESIA_API_KEY ?? "",
		DAYTONA_API_KEY: bindings.DAYTONA_API_KEY ?? "",
		DAYTONA_API_URL: bindings.DAYTONA_API_URL ?? "https://app.daytona.io/api",
		DAYTONA_TARGET: bindings.DAYTONA_TARGET ?? "us",
		TELEGRAM_BOT_TOKEN: bindings.TELEGRAM_BOT_TOKEN ?? "",
		TELEGRAM_WEBHOOK_SECRET: bindings.TELEGRAM_WEBHOOK_SECRET ?? "",
		DATABASE_URL: bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? "",
		BETTER_AUTH_SECRET: bindings.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: bindings.BETTER_AUTH_URL ?? "http://localhost:3000",
		ENABLE_CUA: bindings.ENABLE_CUA === "true",
		POSTHOG_KEY: bindings.POSTHOG_KEY ?? "",
		POSTHOG_HOST: bindings.POSTHOG_HOST ?? "https://us.i.posthog.com",
	})
