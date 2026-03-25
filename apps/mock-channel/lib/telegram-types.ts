/** A message stored in the mock channel's in-memory store. */
export interface StoredMessage {
	message_id: number
	chat_id: number
	text: string
	from_bot: boolean
	date: number
	edited?: boolean
}

/** Configuration for the mock user sending messages. */
export interface MockUserConfig {
	chatId: number
	userId: number
	firstName: string
	lastName?: string
	username?: string
}
