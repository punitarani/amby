import type {
	MockUserConfig,
	TelegramChat,
	TelegramUpdate,
	TelegramUser,
} from "./telegram-types"

let nextUpdateId = 1
let nextMessageId = 1

export function buildTelegramUpdate(params: {
	text: string
	user: MockUserConfig
}): TelegramUpdate {
	const { text, user } = params

	const from: TelegramUser = {
		id: user.telegramUserId,
		is_bot: false,
		first_name: user.firstName,
		last_name: user.lastName,
		username: user.username,
		language_code: "en",
	}

	const chat: TelegramChat = {
		id: user.chatId,
		type: "private",
		first_name: user.firstName,
		last_name: user.lastName,
		username: user.username,
	}

	const update: TelegramUpdate = {
		update_id: nextUpdateId++,
		message: {
			message_id: nextMessageId++,
			from,
			chat,
			date: Math.floor(Date.now() / 1000),
			text,
		},
	}

	return update
}
