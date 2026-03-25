import type { MockUserConfig } from "./telegram-types"

export function getDefaultMockUser(): MockUserConfig {
	return {
		telegramUserId: 99001,
		firstName: "Dev",
		lastName: "Tester",
		username: "devtester",
		chatId: 99001,
		backendUrl: getBackendUrl(),
		webhookSecret: getWebhookSecret(),
	}
}

export function getBackendUrl(): string {
	return process.env.BACKEND_URL || "http://localhost:3001"
}

export function getWebhookSecret(): string {
	return process.env.TELEGRAM_WEBHOOK_SECRET || "dev-secret"
}

export function getBotToken(): string {
	return process.env.TELEGRAM_BOT_TOKEN || "dev-mock-token"
}
