import {
	base64UrlToString,
	hmacSha256Bytes,
	hmacSha256Hex,
	sha256Bytes,
	stableCompare,
} from "./crypto"
import type {
	TelegramIdentityProfile,
	TelegramMiniAppPayload,
	TelegramWidgetAuthData,
} from "./types"

const parseUnixTimestamp = (value: string) => {
	const parsed = Number.parseInt(value, 10)
	if (!Number.isFinite(parsed)) {
		throw new Error("Invalid Telegram auth timestamp")
	}
	return parsed
}

const ensureFreshAuthDate = (authDateSeconds: number, maxAuthAgeSeconds: number) => {
	const nowSeconds = Math.floor(Date.now() / 1000)
	if (Math.abs(nowSeconds - authDateSeconds) > maxAuthAgeSeconds) {
		throw new Error("Telegram auth data is too old")
	}
}

const toWidgetCheckString = (authData: TelegramWidgetAuthData) =>
	Object.entries(authData)
		.filter(([key]) => key !== "hash")
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join("\n")

const parseMiniAppData = (initData: string) => {
	const params = new URLSearchParams(initData)
	const hash = params.get("hash")
	if (!hash) {
		throw new Error("Telegram Mini App initData is missing hash")
	}
	params.delete("hash")
	return {
		hash,
		checkString: [...params.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => `${key}=${value}`)
			.join("\n"),
		params,
	}
}

export const verifyTelegramWidgetAuth = async (
	authData: TelegramWidgetAuthData,
	options: { botToken: string; maxAuthAgeSeconds: number },
) => {
	const authDate = parseUnixTimestamp(authData.auth_date)
	ensureFreshAuthDate(authDate, options.maxAuthAgeSeconds)

	const secret = await sha256Bytes(options.botToken)
	const expectedHash = await hmacSha256Hex(secret, toWidgetCheckString(authData))
	if (!stableCompare(expectedHash, authData.hash.toLowerCase())) {
		throw new Error("Telegram Login Widget signature mismatch")
	}
}

export const parseTelegramWidgetProfile = (
	authData: TelegramWidgetAuthData,
): TelegramIdentityProfile => ({
	id: authData.id,
	firstName: authData.first_name,
	lastName: authData.last_name ?? null,
	username: authData.username ?? null,
	photoUrl: authData.photo_url ?? null,
})

export const verifyTelegramMiniAppInitData = async (
	initData: string,
	options: { botToken: string; maxAuthAgeSeconds: number },
): Promise<TelegramMiniAppPayload> => {
	const { hash, checkString, params } = parseMiniAppData(initData)
	const secret = await hmacSha256Bytes("WebAppData", options.botToken)
	const expectedHash = await hmacSha256Hex(secret, checkString)
	if (!stableCompare(expectedHash, hash.toLowerCase())) {
		throw new Error("Telegram Mini App signature mismatch")
	}

	const authDate = parseUnixTimestamp(params.get("auth_date") ?? "")
	ensureFreshAuthDate(authDate, options.maxAuthAgeSeconds)

	const rawUser = params.get("user")
	if (!rawUser) {
		throw new Error("Telegram Mini App initData is missing user")
	}

	const parsedUser = JSON.parse(rawUser) as Record<string, unknown>
	const id = String(parsedUser.id ?? "")
	if (!id) {
		throw new Error("Telegram Mini App user is missing id")
	}

	return {
		authDate,
		queryId: params.get("query_id") ?? undefined,
		startParam: params.get("start_param") ?? undefined,
		chatType: params.get("chat_type") ?? undefined,
		chatInstance: params.get("chat_instance") ?? undefined,
		user: {
			id,
			first_name: String(parsedUser.first_name ?? ""),
			last_name: parsedUser.last_name ? String(parsedUser.last_name) : undefined,
			username: parsedUser.username ? String(parsedUser.username) : undefined,
			language_code: parsedUser.language_code ? String(parsedUser.language_code) : undefined,
			is_premium: Boolean(parsedUser.is_premium),
			photo_url: parsedUser.photo_url ? String(parsedUser.photo_url) : undefined,
		},
	}
}

export const parseTelegramMiniAppProfile = (
	payload: TelegramMiniAppPayload,
): TelegramIdentityProfile => ({
	id: payload.user.id,
	firstName: payload.user.first_name,
	lastName: payload.user.last_name ?? null,
	username: payload.user.username ?? null,
	languageCode: payload.user.language_code ?? null,
	isPremium: payload.user.is_premium ?? false,
	photoUrl: payload.user.photo_url ?? null,
})

export const decodeBase64UrlJson = <T>(value: string): T =>
	JSON.parse(base64UrlToString(value)) as T
