export const TELEGRAM_PROVIDER_ID = "telegram"

export const TELEGRAM_RELINK_REQUIRED_MESSAGE =
	"Telegram access is currently unlinked for this account. Reconnect Telegram from the app, then send me another message."

export const TELEGRAM_SYNTHETIC_EMAIL_DOMAIN = "telegram.hiamby.invalid"

export const TELEGRAM_OIDC_DISCOVERY_URL =
	"https://oauth.telegram.org/.well-known/openid-configuration"

export const getTelegramBotId = (botToken: string): string | undefined => {
	const id = botToken.split(":")[0]?.trim()
	return id || undefined
}
