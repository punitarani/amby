import { Context, Data } from "effect"

export class EnvError extends Data.TaggedError("EnvError")<{
	readonly message: string
}> {}

export interface WorkflowInstanceStatus {
	readonly status:
		| "queued"
		| "running"
		| "paused"
		| "errored"
		| "terminated"
		| "complete"
		| "waiting"
		| "waitingForPause"
		| "unknown"
	readonly error?: {
		readonly name: string
		readonly message: string
	}
	readonly output?: unknown
}

export interface WorkflowInstanceHandle {
	readonly id: string
	status(): Promise<WorkflowInstanceStatus>
	sendEvent(event: { type: string; payload?: unknown }): Promise<void>
}

export interface WorkflowBinding<Params = unknown> {
	create(options?: { id?: string; params?: Params }): Promise<WorkflowInstanceHandle>
	createBatch?(
		batch: Array<{
			id?: string
			params?: Params
		}>,
	): Promise<WorkflowInstanceHandle[]>
	get(id: string): Promise<WorkflowInstanceHandle>
}

export interface Env {
	// Environment
	readonly NODE_ENV: string
	readonly API_URL: string
	readonly APP_URL: string

	// Database
	readonly DATABASE_URL: string

	// Auth — BetterAuth
	readonly BETTER_AUTH_SECRET: string
	readonly BETTER_AUTH_URL: string

	// LLM, STT, TTS
	readonly OPENROUTER_API_KEY: string
	readonly OPENAI_API_KEY: string
	readonly CARTESIA_API_KEY: string

	// Cloudflare AI Gateway
	readonly CLOUDFLARE_AI_GATEWAY_ID: string
	readonly CLOUDFLARE_AI_GATEWAY_BASE_URL: string
	readonly CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: string

	// Attachments
	readonly ATTACHMENTS_SIGNING_SECRET: string

	// Telegram
	readonly TELEGRAM_BOT_TOKEN: string
	readonly TELEGRAM_BOT_USERNAME: string
	readonly TELEGRAM_WEBHOOK_SECRET: string
	readonly TELEGRAM_API_BASE_URL?: string
	readonly TELEGRAM_LOGIN_WIDGET_ENABLED: boolean
	readonly TELEGRAM_MINI_APP_ENABLED: boolean
	readonly TELEGRAM_OIDC_CLIENT_ID: string
	readonly TELEGRAM_OIDC_CLIENT_SECRET: string
	readonly TELEGRAM_OIDC_REQUEST_PHONE: boolean
	readonly TELEGRAM_OIDC_REQUEST_BOT_ACCESS: boolean
	readonly TELEGRAM_MAX_AUTH_AGE_SECONDS: number

	// Daytona Sandbox
	readonly DAYTONA_API_KEY: string
	readonly DAYTONA_API_URL: string
	readonly DAYTONA_TARGET: string

	// Computer / Sandbox
	readonly ENABLE_CUA: boolean

	// Composio connectors
	readonly COMPOSIO_API_KEY: string
	readonly COMPOSIO_WEBHOOK_SECRET: string
	readonly COMPOSIO_AUTH_CONFIG_GMAIL: string
	readonly COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: string
	readonly COMPOSIO_AUTH_CONFIG_NOTION: string
	readonly COMPOSIO_AUTH_CONFIG_SLACK: string
	readonly COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: string

	// Braintrust — agent observability & tracing
	readonly BRAINTRUST_API_KEY: string
	readonly BRAINTRUST_PROJECT_ID: string

	// PostHog analytics
	readonly POSTHOG_KEY: string
	readonly POSTHOG_HOST: string

	// Vault
	readonly VAULT_KEK: string
	readonly VAULT_KEK_VERSION: number

	// Workflows
	readonly SANDBOX_WORKFLOW?: WorkflowBinding<{ userId: string }>
	readonly VOLUME_WORKFLOW?: WorkflowBinding<{ userId: string; parentWorkflowId?: string }>
}

export const DEFAULT_TELEGRAM_BOT_USERNAME = "my_amby_bot"

export const normalizeTelegramBotUsername = (value?: string | null): string =>
	(value?.trim().replace(/^@+/, "").toLowerCase() ?? "") || DEFAULT_TELEGRAM_BOT_USERNAME

export class EnvService extends Context.Tag("EnvService")<EnvService, Env>() {}
