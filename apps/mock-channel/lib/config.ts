export function getBackendUrl(): string {
	return process.env.MOCK_BACKEND_URL ?? "http://localhost:3001"
}

export function getWebhookSecret(): string {
	return process.env.MOCK_WEBHOOK_SECRET ?? "mock-secret"
}

export function getBotToken(): string {
	return process.env.MOCK_BOT_TOKEN ?? "000000000:MOCK-TOKEN"
}
