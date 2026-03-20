const DEFAULT_TELEGRAM_BOT_USERNAME = "my_amby_bot"

export const normalizeTelegramBotUsername = (value?: string) => {
	const normalized = value?.trim().replace(/^@+/, "") ?? ""
	return normalized || DEFAULT_TELEGRAM_BOT_USERNAME
}

export const TELEGRAM_BOT_USERNAME = normalizeTelegramBotUsername(
	process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
)

export const TELEGRAM_BOT_HANDLE = `@${TELEGRAM_BOT_USERNAME}`

export const buildTelegramBotUrl = (username = TELEGRAM_BOT_USERNAME) =>
	`https://t.me/${normalizeTelegramBotUsername(username)}`

export const TELEGRAM_BOT_URL = buildTelegramBotUrl()

export const buildTelegramStartUrl = (payload?: string, username = TELEGRAM_BOT_USERNAME) =>
	payload
		? `${buildTelegramBotUrl(username)}?start=${encodeURIComponent(payload)}`
		: buildTelegramBotUrl(username)
