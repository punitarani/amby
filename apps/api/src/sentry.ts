import type { WorkerBindings } from "@amby/env/workers"
import type { DbConnectionMode } from "@amby/env"
import type { CloudflareOptions, Scope } from "@sentry/cloudflare"
import * as Sentry from "@sentry/cloudflare"
import type { TelegramFrom } from "./telegram/utils"

type ScopeAttribute = string | number | boolean | undefined

const REDACTED = "[redacted]"
const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie)/i

const withDefinedAttributes = (attributes: Record<string, ScopeAttribute>) =>
	Object.fromEntries(
		Object.entries(attributes).filter(([, value]) => value !== undefined),
	) as Record<string, string | number | boolean>

const redactLogAttributes = (attributes?: Record<string, unknown>) => {
	if (!attributes) return attributes

	return Object.fromEntries(
		Object.entries(attributes).map(([key, value]) => [
			key,
			SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : value,
		]),
	)
}

export const getSentryOptions = (env: WorkerBindings): CloudflareOptions | undefined => {
	const dsn = env.SENTRY_DSN?.trim()
	if (!dsn) return undefined

	return {
		dsn,
		environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "production",
		release: env.SENTRY_RELEASE ?? env.CF_VERSION_METADATA?.id,
		enableLogs: true,
		tracesSampleRate: env.NODE_ENV === "production" ? 0.2 : 1.0,
		integrations: [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })],
		beforeSend: (event) => {
			if (!event.request?.url?.includes("/telegram/webhook")) {
				return event
			}

			return {
				...event,
				request: event.request ? { ...event.request, data: undefined } : event.request,
			}
		},
		beforeSendLog: (log) => ({
			...log,
			attributes: redactLogAttributes(log.attributes),
		}),
	}
}

export const getSentryOptionsOrFallback = (env: WorkerBindings): CloudflareOptions => {
	const opts = getSentryOptions(env)
	if (!opts) return { enabled: false }
	return opts
}

const setScopeAttributes = (scope: Scope, attributes: Record<string, ScopeAttribute>) => {
	scope.setAttributes(withDefinedAttributes(attributes))
}

export const setDatabaseScopeAttributes = (
	scope: Scope,
	params: {
		mode?: DbConnectionMode
		failureStage?: "config" | "reconciliation_preflight" | "reconciliation_run"
	},
) => {
	if (params.mode) {
		scope.setTag("db.connection_mode", params.mode)
	}
	if (params.failureStage) {
		scope.setTag("db.failure_stage", params.failureStage)
	}
	setScopeAttributes(scope, {
		"db.connection_mode": params.mode,
		"db.failure_stage": params.failureStage,
	})
}

export const setWorkerScope = (
	component: string,
	attributes: Record<string, ScopeAttribute> = {},
) => {
	const scope = Sentry.getIsolationScope()
	scope.setTag("service", "amby-api")
	scope.setTag("component", component)
	setScopeAttributes(scope, {
		service: "amby-api",
		component,
		runtime: "cloudflare-worker",
		...attributes,
	})
	return scope
}

interface TelegramScopeInput {
	component: string
	chatId?: number | null
	from?: TelegramFrom | null
	userId?: string | null
	conversationId?: string | null
	attributes?: Record<string, ScopeAttribute>
}

export const setTelegramScope = ({
	component,
	chatId,
	from,
	userId,
	conversationId,
	attributes,
}: TelegramScopeInput) => {
	const scope = setWorkerScope(component, {
		channel: "telegram",
		telegram_chat_id: chatId ?? undefined,
		telegram_from_id: from?.id,
		telegram_is_premium: from?.is_premium,
		...attributes,
	})

	scope.setTag("channel", "telegram")
	if (chatId) scope.setTag("telegram.chat_id", String(chatId))
	if (conversationId) {
		scope.setTag("conversation.id", conversationId)
		scope.setConversationId(conversationId)
	}

	if (userId || from?.id) {
		scope.setUser({
			id: userId ?? String(from?.id),
			username: from?.username,
		})
	}

	if (from) {
		scope.setContext("telegram", {
			chatId: chatId ?? null,
			fromId: from.id,
			username: from.username ?? null,
			firstName: from.first_name,
			lastName: from.last_name ?? null,
			languageCode: from.language_code ?? null,
			isPremium: from.is_premium ?? false,
		})
	}

	return scope
}
