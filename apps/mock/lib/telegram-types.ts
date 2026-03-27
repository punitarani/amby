/** Minimal Telegram-compatible types for the mock channel */

export interface TelegramUser {
	id: number
	is_bot: boolean
	first_name: string
	last_name?: string
	username?: string
	language_code?: string
}

export interface TelegramChat {
	id: number
	type: "private" | "group" | "supergroup" | "channel"
	first_name?: string
	last_name?: string
	username?: string
}

export interface TelegramMessage {
	message_id: number
	from: TelegramUser
	chat: TelegramChat
	date: number
	text?: string
}

export interface TelegramUpdate {
	update_id: number
	message?: TelegramMessage
}

/** User-configurable identity for the mock channel */
export interface MockUserConfig {
	telegramUserId: number
	firstName: string
	lastName?: string
	username?: string
	chatId: number
	backendUrl: string
	webhookSecret: string
}

/** A display message in the mock channel UI */
export interface DisplayMessage {
	id: string
	role: "user" | "bot"
	text: string
	parseMode?: string
	timestamp: number
}

/** Request log entry for the debug panel */
export interface RequestLogEntry {
	id: string
	timestamp: number
	direction: "inbound" | "outbound"
	method: string
	url: string
	body: unknown
	response?: {
		status: number
		body: unknown
	}
}
