import { Layer } from "effect"
import { EnvService } from "./shared"

export interface WorkerBindings {
	NODE_ENV?: string
	APP_URL?: string
	OPENROUTER_API_KEY: string
	OPENAI_API_KEY?: string
	CARTESIA_API_KEY?: string
	DAYTONA_API_KEY?: string
	DAYTONA_API_URL?: string
	DAYTONA_TARGET?: string
	SENTRY_DSN?: string
	SENTRY_ENVIRONMENT?: string
	SENTRY_RELEASE?: string
	TELEGRAM_BOT_TOKEN?: string
	TELEGRAM_BOT_USERNAME?: string
	TELEGRAM_WEBHOOK_SECRET?: string
	COMPOSIO_API_KEY?: string
	COMPOSIO_WEBHOOK_SECRET?: string
	COMPOSIO_AUTH_CONFIG_GMAIL?: string
	COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR?: string
	COMPOSIO_AUTH_CONFIG_NOTION?: string
	COMPOSIO_AUTH_CONFIG_SLACK?: string
	COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE?: string
	DATABASE_URL?: string
	BETTER_AUTH_SECRET: string
	BETTER_AUTH_URL?: string
	ENABLE_CUA?: string
	BRAINTRUST_API_KEY?: string
	BRAINTRUST_PROJECT_ID?: string
	HYPERDRIVE?: { connectionString: string }
	POSTHOG_KEY?: string
	POSTHOG_HOST?: string
	CF_VERSION_METADATA?: { id?: string }

	// Cloudflare primitives — typed structurally for portability
	TELEGRAM_QUEUE?: { send(body: unknown, options?: { contentType?: string }): Promise<void> }
	TELEGRAM_DLQ?: { send(body: unknown, options?: { contentType?: string }): Promise<void> }
	CONVERSATION_SESSION?: {
		idFromName(name: string): { toString(): string }
		get(id: { toString(): string }): { ingestMessage(msg: unknown): Promise<void> }
	}
	AGENT_WORKFLOW?: {
		create(options: { id?: string; params?: unknown }): Promise<{ id: string }>
		get(
			id: string,
		): Promise<{ status(): Promise<unknown>; sendEvent(event: unknown): Promise<void> }>
	}
	SANDBOX_WORKFLOW?: {
		create(options: { id?: string; params?: { userId: string } }): Promise<{ id: string }>
		get(
			id: string,
		): Promise<{ status(): Promise<unknown>; sendEvent(event: unknown): Promise<void> }>
	}
}

export const makeEnvServiceFromBindings = (bindings: WorkerBindings) =>
	Layer.succeed(EnvService, {
		NODE_ENV: bindings.NODE_ENV ?? "production",
		APP_URL: bindings.APP_URL ?? "https://hiamby.com",
		OPENROUTER_API_KEY: bindings.OPENROUTER_API_KEY,
		OPENAI_API_KEY: bindings.OPENAI_API_KEY ?? "",
		CARTESIA_API_KEY: bindings.CARTESIA_API_KEY ?? "",
		DAYTONA_API_KEY: bindings.DAYTONA_API_KEY ?? "",
		DAYTONA_API_URL: bindings.DAYTONA_API_URL ?? "https://app.daytona.io/api",
		DAYTONA_TARGET: bindings.DAYTONA_TARGET ?? "us",
		TELEGRAM_BOT_TOKEN: bindings.TELEGRAM_BOT_TOKEN ?? "",
		TELEGRAM_BOT_USERNAME: bindings.TELEGRAM_BOT_USERNAME ?? "my_amby_bot",
		TELEGRAM_WEBHOOK_SECRET: bindings.TELEGRAM_WEBHOOK_SECRET ?? "",
		COMPOSIO_API_KEY: bindings.COMPOSIO_API_KEY ?? "",
		COMPOSIO_WEBHOOK_SECRET: bindings.COMPOSIO_WEBHOOK_SECRET ?? "",
		COMPOSIO_AUTH_CONFIG_GMAIL: bindings.COMPOSIO_AUTH_CONFIG_GMAIL ?? "",
		COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: bindings.COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR ?? "",
		COMPOSIO_AUTH_CONFIG_NOTION: bindings.COMPOSIO_AUTH_CONFIG_NOTION ?? "",
		COMPOSIO_AUTH_CONFIG_SLACK: bindings.COMPOSIO_AUTH_CONFIG_SLACK ?? "",
		COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: bindings.COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE ?? "",
		DATABASE_URL: bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? "",
		BETTER_AUTH_SECRET: bindings.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: bindings.BETTER_AUTH_URL ?? "http://localhost:3000",
		ENABLE_CUA: bindings.ENABLE_CUA === "true",
		BRAINTRUST_API_KEY: bindings.BRAINTRUST_API_KEY ?? "",
		BRAINTRUST_PROJECT_ID: bindings.BRAINTRUST_PROJECT_ID ?? "",
		POSTHOG_KEY: bindings.POSTHOG_KEY ?? "",
		POSTHOG_HOST: bindings.POSTHOG_HOST ?? "https://us.i.posthog.com",
	})
