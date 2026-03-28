export interface TelegramIdentityProfile {
	id: string
	firstName: string
	lastName?: string | null
	username?: string | null
	languageCode?: string | null
	isPremium?: boolean
	photoUrl?: string | null
	phoneNumber?: string | null
	email?: string | null
	emailVerified?: boolean
}

export interface TelegramWidgetAuthData {
	id: string
	first_name: string
	last_name?: string
	username?: string
	photo_url?: string
	auth_date: string
	hash: string
}

export interface TelegramMiniAppUser {
	id: string
	first_name: string
	last_name?: string
	username?: string
	language_code?: string
	is_premium?: boolean
	photo_url?: string
}

export interface TelegramMiniAppPayload {
	authDate: number
	queryId?: string
	startParam?: string
	chatType?: string
	chatInstance?: string
	user: TelegramMiniAppUser
}

export interface TelegramLoginWidgetOptions {
	size?: "large" | "medium" | "small"
	cornerRadius?: number
	requestAccess?: "write" | "read"
	showUserPhoto?: boolean
}

export interface TelegramProvisionInput {
	source: "bot" | "widget" | "miniapp" | "oidc"
	chatId?: string | null
	profile: TelegramIdentityProfile
}
