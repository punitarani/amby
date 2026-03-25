export interface StoredMessage {
	message_id: number
	chat_id: number
	text: string
	from_bot: boolean
	date: number
	edit_date?: number
}

export interface RequestLogEntry {
	id: number
	timestamp: number
	direction: "inbound" | "outbound"
	method: string
	url: string
	body: Record<string, unknown>
}

export interface MessageStore {
	messages: StoredMessage[]
	log: RequestLogEntry[]
	nextMessageId: number
	nextLogId: number
}
