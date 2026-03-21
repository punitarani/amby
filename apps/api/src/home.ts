import { normalizeTelegramBotUsername } from "@amby/env"

function normalizeApiBaseUrl(url: string | undefined): string {
	if (!url) return ""
	const trimmed = url.trim()
	if (!trimmed) return ""
	return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

function getTelegramBotUrl(): string {
	const username = normalizeTelegramBotUsername(process.env.TELEGRAM_BOT_USERNAME)
	return `https://t.me/${username}`
}

export function getHomeResponse() {
	return {
		api: normalizeApiBaseUrl(process.env.API_URL),
		github: "https://github.com/punitarani/amby",
		telegram: getTelegramBotUrl(),
		message:
			"You've reached the assistant computer, not the front desk. It stays on, does the legwork, and leaves the grand speeches to the website.",
	}
}
