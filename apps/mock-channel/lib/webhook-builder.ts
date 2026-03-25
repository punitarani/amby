import type { TelegramUpdate, MockUserConfig } from "./telegram-types"

let nextUpdateId = 100000
let nextMessageId = 1

export function buildTelegramUpdate(params: {
	text: string
	user: MockUserConfig
}): TelegramUpdate {
	const updateId = nextUpdateId++
	const messageId = nextMessageId++

	return {
		update_id: updateId,
		message: {
			message_id: messageId,
			from: {
				id: params.user.telegramUserId,
				is_bot: false,
				first_name: params.user.firstName,
				last_name: params.user.lastName,
				username: params.user.username,
				language_code: "en",
			},
			chat: {
				id: params.user.chatId,
				type: "private",
				first_name: params.user.firstName,
				last_name: params.user.lastName,
				username: params.user.username,
			},
			date: Math.floor(Date.now() / 1000),
			text: params.text,
		},
	}
}

export function resetCounters() {
	nextUpdateId = 100000
	nextMessageId = 1
}
