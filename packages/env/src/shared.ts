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
	sendEvent(event: unknown): Promise<void>
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
	readonly NODE_ENV: string
	readonly API_URL: string
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
	readonly SANDBOX_WORKFLOW?: WorkflowBinding<{ userId: string }>
	readonly VOLUME_WORKFLOW?: WorkflowBinding<{ userId: string }>
}

export const DEFAULT_TELEGRAM_BOT_USERNAME = "my_amby_bot"

export const normalizeTelegramBotUsername = (value?: string | null): string =>
	(value?.trim().replace(/^@+/, "").toLowerCase() ?? "") || DEFAULT_TELEGRAM_BOT_USERNAME

export class EnvService extends Context.Tag("EnvService")<EnvService, Env>() {}
