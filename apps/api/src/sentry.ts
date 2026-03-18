import type { WorkerBindings } from "@amby/env/workers"
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
		tracesSampleRate: 1.0,
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

export const getSentryOptionsOrFallback = (env: WorkerBindings): CloudflareOptions =>
	getSentryOptions(env) ?? {}

const setScopeAttributes = (scope: Scope, attributes: Record<string, ScopeAttribute>) => {
	scope.setAttributes(withDefinedAttributes(attributes))
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
