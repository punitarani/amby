export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined

const pickString = (...values: unknown[]): string | undefined =>
	values.find((value): value is string => typeof value === "string" && value.trim().length > 0)

export const normalizeWebhookPayload = (value: unknown): Record<string, unknown> | undefined => {
	if (typeof value === "string") {
		try {
			return asRecord(JSON.parse(value))
		} catch {
			return undefined
		}
	}

	return asRecord(value)
}

export const getWebhookType = (payload: unknown): string | undefined => {
	const object = normalizeWebhookPayload(payload)
	return pickString(object?.type, asRecord(object?.event)?.type)
}

export const getExpiredConnectedAccountId = (payload: unknown): string | undefined => {
	const object = normalizeWebhookPayload(payload)
	const data = asRecord(object?.data)
	const connectedAccount = asRecord(
		data?.connectedAccount ??
			data?.connected_account ??
			object?.connectedAccount ??
			object?.connected_account,
	)

	return pickString(
		data?.connectedAccountId,
		data?.connected_account_id,
		data?.id,
		object?.connectedAccountId,
		object?.connected_account_id,
		connectedAccount?.id,
	)
}

export const getTelegramChatId = (metadata: unknown): number | undefined => {
	const object = asRecord(metadata)
	if (!object) return undefined

	const value = object.chatId
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}

	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10)
		return Number.isFinite(parsed) ? parsed : undefined
	}

	return undefined
}
