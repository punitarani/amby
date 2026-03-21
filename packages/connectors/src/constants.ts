export {
	INTEGRATION_LABELS,
	SUPPORTED_INTEGRATION_TOOLKITS,
	type SupportedIntegrationToolkit,
	TOOLKIT_REGISTRY,
} from "./registry"

import {
	SUPPORTED_INTEGRATION_TOOLKITS,
	type SupportedIntegrationToolkit,
	TOOLKIT_REGISTRY,
} from "./registry"

export const COMPOSIO_DESTRUCTIVE_TAG = "destructiveHint" as const

export { DEFAULT_TELEGRAM_BOT_USERNAME } from "@amby/env"

export function isSupportedIntegrationToolkit(value: string): value is SupportedIntegrationToolkit {
	return SUPPORTED_INTEGRATION_TOOLKITS.includes(value as SupportedIntegrationToolkit)
}

export function getIntegrationLabel(toolkit: SupportedIntegrationToolkit): string {
	return TOOLKIT_REGISTRY[toolkit].label
}

export function getIntegrationSuccessMessage(toolkit: SupportedIntegrationToolkit): string {
	return TOOLKIT_REGISTRY[toolkit].messages.success
}

export function getIntegrationExpiredMessage(toolkit: SupportedIntegrationToolkit): string {
	return TOOLKIT_REGISTRY[toolkit].messages.expired
}

export function buildIntegrationStartPayload(toolkit: SupportedIntegrationToolkit): string {
	return `connect-${toolkit}`
}

export function parseIntegrationStartPayload(
	payload?: string | null,
): SupportedIntegrationToolkit | undefined {
	if (!payload) return undefined

	const match = /^connect-([a-z]+)$/i.exec(payload.trim())
	if (!match?.[1]) return undefined

	return isSupportedIntegrationToolkit(match[1]) ? match[1] : undefined
}

const COMPOSIO_REDIRECT_TARGET = "https://backend.composio.dev/api/v3/toolkits/auth/callback"
const ALLOWED_REDIRECT_PARAMS = new Set(["code", "state", "error", "error_description", "scope"])

export function buildSafeComposioRedirectUrl(requestUrl: string): string {
	const incoming = new URL(requestUrl).searchParams
	const filtered = new URLSearchParams()
	for (const [key, value] of incoming) {
		if (ALLOWED_REDIRECT_PARAMS.has(key)) filtered.set(key, value)
	}
	const qs = filtered.toString()
	return `${COMPOSIO_REDIRECT_TARGET}${qs ? `?${qs}` : ""}`
}
