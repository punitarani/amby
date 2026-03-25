export interface StoredMessage {
	message_id: number
	chat_id: number
	text: string
	from_bot: boolean
	date: number
	edited?: boolean
	deleted?: boolean
}

export interface RequestLogEntry {
	id: string
	timestamp: number
	direction: "inbound" | "outbound"
	method: string
	url: string
	body: unknown
	response?: { status: number; body: unknown }
}

export interface MockUserConfig {
	telegramUserId: number
	firstName: string
	lastName?: string
	username?: string
	chatId: number
	backendUrl: string
	webhookSecret: string
}
