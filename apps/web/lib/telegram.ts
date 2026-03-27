// Canonical source: @amby/env (DEFAULT_TELEGRAM_BOT_USERNAME)
const DEFAULT_TELEGRAM_BOT_USERNAME = "my_amby_bot"

export const normalizeTelegramBotUsername = (value?: string | null) => {
	const normalized = value?.trim().replace(/^@+/, "").toLowerCase() ?? ""
	return normalized || DEFAULT_TELEGRAM_BOT_USERNAME
}

export const TELEGRAM_BOT_USERNAME = normalizeTelegramBotUsername(
	process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
)

export const TELEGRAM_BOT_HANDLE = `@${TELEGRAM_BOT_USERNAME}`

export const buildTelegramBotUrl = (username = TELEGRAM_BOT_USERNAME) =>
	`https://t.me/${normalizeTelegramBotUsername(username)}`

export const TELEGRAM_BOT_URL = buildTelegramBotUrl()

/** True when the link opens Telegram (t.me / same origin as the bot URL). */
export const isTelegramWebUrl = (href: string): boolean => {
	const trimmed = href.trim()
	if (!trimmed) return false
	if (trimmed === TELEGRAM_BOT_URL) return true
	try {
		const u = new URL(trimmed)
		return u.hostname === "t.me"
	} catch {
		return /^https?:\/\/t\.me\//i.test(trimmed)
	}
}

export const buildTelegramStartUrl = (payload?: string, username = TELEGRAM_BOT_USERNAME) =>
	payload
		? `${buildTelegramBotUrl(username)}?start=${encodeURIComponent(payload)}`
		: buildTelegramBotUrl(username)
