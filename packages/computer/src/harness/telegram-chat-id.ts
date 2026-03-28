const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined

export const getTelegramChatId = (metadata: unknown): number | undefined => {
	if (typeof metadata === "number" && Number.isFinite(metadata)) {
		return metadata
	}

	if (typeof metadata === "string") {
		const parsed = Number.parseInt(metadata, 10)
		return Number.isFinite(parsed) ? parsed : undefined
	}

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
