import type { MockUserConfig, TelegramUpdate } from "./telegram-types"

let updateIdCounter = 100000
let messageIdCounter = 1

/**
 * Build a Telegram-compatible webhook update payload from a user message.
 */
export function buildWebhookUpdate(text: string, config: MockUserConfig): TelegramUpdate {
	return {
		update_id: updateIdCounter++,
		message: {
			message_id: messageIdCounter++,
			from: {
				id: config.telegramUserId,
				is_bot: false,
				first_name: config.firstName,
				last_name: config.lastName,
				username: config.username,
				language_code: "en",
			},
			chat: {
				id: config.chatId,
				type: "private",
				first_name: config.firstName,
				last_name: config.lastName,
				username: config.username,
			},
			date: Math.floor(Date.now() / 1000),
			text,
		},
	}
}

export function resetCounters() {
	updateIdCounter = 100000
	messageIdCounter = 1
}
