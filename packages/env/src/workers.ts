import { Layer } from "effect"
import { DEFAULT_TELEGRAM_BOT_USERNAME, EnvService, type WorkflowBinding } from "./shared"

export interface WorkerBindings {
	// Environment
	NODE_ENV?: string
	API_URL?: string
	APP_URL?: string

	// Database
	DATABASE_URL?: string
	HYPERDRIVE?: { connectionString: string }

	// Auth — BetterAuth
	BETTER_AUTH_SECRET: string
	BETTER_AUTH_URL: string

	// LLM, STT, TTS
	OPENROUTER_API_KEY: string
	OPENAI_API_KEY?: string
	CARTESIA_API_KEY?: string

	// Cloudflare AI Gateway
	CLOUDFLARE_AI_GATEWAY_ID: string
	CLOUDFLARE_AI_GATEWAY_BASE_URL: string
	CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: string

	// Attachments
	ATTACHMENTS_SIGNING_SECRET: string
	ATTACHMENTS_BUCKET?: {
		put(key: string, value: ArrayBuffer | ArrayBufferView | Blob | string): Promise<void>
		get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
	}

	// Telegram
	TELEGRAM_BOT_TOKEN: string
	TELEGRAM_BOT_USERNAME?: string
	TELEGRAM_WEBHOOK_SECRET: string
	TELEGRAM_API_BASE_URL?: string
	TELEGRAM_LOGIN_WIDGET_ENABLED?: string
	TELEGRAM_MINI_APP_ENABLED?: string
	TELEGRAM_OIDC_CLIENT_ID?: string
	TELEGRAM_OIDC_CLIENT_SECRET?: string
	TELEGRAM_OIDC_REQUEST_PHONE?: string
	TELEGRAM_OIDC_REQUEST_BOT_ACCESS?: string
	TELEGRAM_MAX_AUTH_AGE_SECONDS?: string

	// Daytona Sandbox
	DAYTONA_API_KEY: string
	DAYTONA_API_URL?: string
	DAYTONA_TARGET?: string

	// Computer / Sandbox
	ENABLE_CUA?: string

	// Composio connectors
	COMPOSIO_API_KEY: string
	COMPOSIO_WEBHOOK_SECRET: string
	COMPOSIO_AUTH_CONFIG_GMAIL?: string
	COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR?: string
	COMPOSIO_AUTH_CONFIG_NOTION?: string
	COMPOSIO_AUTH_CONFIG_SLACK?: string
	COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE?: string

	// Braintrust — agent observability & tracing
	BRAINTRUST_API_KEY: string
	BRAINTRUST_PROJECT_ID: string

	// Sentry — error tracking
	SENTRY_DSN: string
	SENTRY_ENVIRONMENT?: string
	SENTRY_RELEASE?: string

	// PostHog analytics
	POSTHOG_KEY?: string
	POSTHOG_HOST?: string

	// Cloudflare platform bindings
	CF_VERSION_METADATA?: { id?: string }
	BROWSER?: unknown
	/** Workers AI binding — used by the Stagehand browser worker. */
	AI?: unknown
	TELEGRAM_QUEUE?: { send(body: unknown, options?: { contentType?: string }): Promise<void> }
	TELEGRAM_DLQ?: { send(body: unknown, options?: { contentType?: string }): Promise<void> }
	AMBY_CONVERSATION?: {
		idFromName(name: string): { toString(): string }
		get(id: { toString(): string }): { ingestMessage(msg: unknown): Promise<void> }
	}
	AMBY_AGENT_EXECUTION?: WorkflowBinding<unknown>
	AMBY_SANDBOX_PROVISION?: WorkflowBinding<{ userId: string }>
	AMBY_VOLUME_PROVISION?: WorkflowBinding<{ userId: string; parentWorkflowId?: string }>
}

export const makeEnvServiceFromBindings = (bindings: WorkerBindings) =>
	Layer.succeed(EnvService, {
		// Environment
		NODE_ENV: bindings.NODE_ENV ?? "production",
		API_URL: bindings.API_URL ?? "https://api.hiamby.com",
		APP_URL: bindings.APP_URL ?? "https://hiamby.com",

		// Database
		DATABASE_URL: bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? "",

		// Auth — BetterAuth
		BETTER_AUTH_SECRET: bindings.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: bindings.BETTER_AUTH_URL,

		// LLM, STT, TTS
		OPENROUTER_API_KEY: bindings.OPENROUTER_API_KEY,
		OPENAI_API_KEY: bindings.OPENAI_API_KEY ?? "",
		CARTESIA_API_KEY: bindings.CARTESIA_API_KEY ?? "",

		// Cloudflare AI Gateway
		CLOUDFLARE_AI_GATEWAY_ID: bindings.CLOUDFLARE_AI_GATEWAY_ID,
		CLOUDFLARE_AI_GATEWAY_BASE_URL: bindings.CLOUDFLARE_AI_GATEWAY_BASE_URL,
		CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: bindings.CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN,

		// Attachments
		ATTACHMENTS_SIGNING_SECRET: bindings.ATTACHMENTS_SIGNING_SECRET,

		// Telegram
		TELEGRAM_BOT_TOKEN: bindings.TELEGRAM_BOT_TOKEN,
		TELEGRAM_BOT_USERNAME: bindings.TELEGRAM_BOT_USERNAME ?? DEFAULT_TELEGRAM_BOT_USERNAME,
		TELEGRAM_WEBHOOK_SECRET: bindings.TELEGRAM_WEBHOOK_SECRET,
		TELEGRAM_API_BASE_URL: bindings.TELEGRAM_API_BASE_URL,
		TELEGRAM_LOGIN_WIDGET_ENABLED: bindings.TELEGRAM_LOGIN_WIDGET_ENABLED !== "false",
		TELEGRAM_MINI_APP_ENABLED: bindings.TELEGRAM_MINI_APP_ENABLED === "true",
		TELEGRAM_OIDC_CLIENT_ID: bindings.TELEGRAM_OIDC_CLIENT_ID ?? "",
		TELEGRAM_OIDC_CLIENT_SECRET: bindings.TELEGRAM_OIDC_CLIENT_SECRET ?? "",
		TELEGRAM_OIDC_REQUEST_PHONE: bindings.TELEGRAM_OIDC_REQUEST_PHONE === "true",
		TELEGRAM_OIDC_REQUEST_BOT_ACCESS: bindings.TELEGRAM_OIDC_REQUEST_BOT_ACCESS === "true",
		TELEGRAM_MAX_AUTH_AGE_SECONDS: Number.parseInt(
			bindings.TELEGRAM_MAX_AUTH_AGE_SECONDS ?? "86400",
			10,
		),

		// Daytona Sandbox
		DAYTONA_API_KEY: bindings.DAYTONA_API_KEY,
		DAYTONA_API_URL: bindings.DAYTONA_API_URL ?? "https://app.daytona.io/api",
		DAYTONA_TARGET: bindings.DAYTONA_TARGET ?? "us",

		// Computer / Sandbox
		ENABLE_CUA: bindings.ENABLE_CUA === "true",

		// Composio connectors
		COMPOSIO_API_KEY: bindings.COMPOSIO_API_KEY,
		COMPOSIO_WEBHOOK_SECRET: bindings.COMPOSIO_WEBHOOK_SECRET,
		COMPOSIO_AUTH_CONFIG_GMAIL: bindings.COMPOSIO_AUTH_CONFIG_GMAIL ?? "",
		COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: bindings.COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR ?? "",
		COMPOSIO_AUTH_CONFIG_NOTION: bindings.COMPOSIO_AUTH_CONFIG_NOTION ?? "",
		COMPOSIO_AUTH_CONFIG_SLACK: bindings.COMPOSIO_AUTH_CONFIG_SLACK ?? "",
		COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: bindings.COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE ?? "",

		// Braintrust — agent observability & tracing
		BRAINTRUST_API_KEY: bindings.BRAINTRUST_API_KEY,
		BRAINTRUST_PROJECT_ID: bindings.BRAINTRUST_PROJECT_ID,

		// PostHog analytics
		POSTHOG_KEY: bindings.POSTHOG_KEY ?? "",
		POSTHOG_HOST: bindings.POSTHOG_HOST ?? "https://us.i.posthog.com",

		// Workflows
		AMBY_SANDBOX_PROVISION: bindings.AMBY_SANDBOX_PROVISION,
		AMBY_VOLUME_PROVISION: bindings.AMBY_VOLUME_PROVISION,
	})
