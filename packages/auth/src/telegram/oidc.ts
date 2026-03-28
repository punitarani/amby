import type { Env } from "@amby/env"
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth"
import { getTelegramBotId, TELEGRAM_OIDC_DISCOVERY_URL } from "./constants"
import { base64UrlToUint8Array } from "./crypto"
import type { TelegramIdentityServiceApi } from "./identity-service"
import { decodeBase64UrlJson } from "./verification"

type TelegramOidcDiscovery = {
	issuer: string
	jwks_uri: string
}

type TelegramOidcJwtHeader = {
	alg?: string
	kid?: string
}

type TelegramOidcClaims = {
	iss?: string
	aud?: string | string[]
	exp?: number
	nbf?: number
	iat?: number
	sub?: string
	name?: string
	given_name?: string
	family_name?: string
	preferred_username?: string
	phone_number?: string
	picture?: string
	photo_url?: string
	email?: string
	email_verified?: boolean
}

type JsonWebKeySet = {
	keys: Array<Record<string, unknown> & { kid?: string }>
}

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000

let cachedDiscovery:
	| {
			expiresAt: number
			value: TelegramOidcDiscovery
	  }
	| undefined
let cachedJwks:
	| {
			url: string
			expiresAt: number
			value: JsonWebKeySet
	  }
	| undefined

const textEncoder = new TextEncoder()

export const resetTelegramOidcCachesForTests = () => {
	cachedDiscovery = undefined
	cachedJwks = undefined
}

const getTelegramOidcClientId = (
	env: Pick<Env, "TELEGRAM_BOT_TOKEN" | "TELEGRAM_OIDC_CLIENT_ID">,
) => {
	if (env.TELEGRAM_OIDC_CLIENT_ID) {
		return env.TELEGRAM_OIDC_CLIENT_ID
	}
	return getTelegramBotId(env.TELEGRAM_BOT_TOKEN)
}

const getDiscovery = async (): Promise<TelegramOidcDiscovery> => {
	const now = Date.now()
	if (cachedDiscovery && cachedDiscovery.expiresAt > now) {
		return cachedDiscovery.value
	}
	const response = await fetch(TELEGRAM_OIDC_DISCOVERY_URL)
	if (!response.ok) {
		throw new Error(`Failed to load Telegram OIDC discovery document: ${response.status}`)
	}
	const discovery = (await response.json()) as TelegramOidcDiscovery
	cachedDiscovery = {
		value: discovery,
		expiresAt: now + DISCOVERY_CACHE_TTL_MS,
	}
	return discovery
}

const getJwks = async (jwksUrl: string): Promise<JsonWebKeySet> => {
	const now = Date.now()
	if (cachedJwks && cachedJwks.url === jwksUrl && cachedJwks.expiresAt > now) {
		return cachedJwks.value
	}
	const response = await fetch(jwksUrl)
	if (!response.ok) {
		throw new Error(`Failed to load Telegram JWKS: ${response.status}`)
	}
	const jwks = (await response.json()) as JsonWebKeySet
	cachedJwks = {
		url: jwksUrl,
		value: jwks,
		expiresAt: now + DISCOVERY_CACHE_TTL_MS,
	}
	return jwks
}

const verifyJwtSignature = async (
	segments: { header: string; payload: string; signature: string },
	header: TelegramOidcJwtHeader,
	jwks: JsonWebKeySet,
) => {
	if (header.alg !== "RS256" || !header.kid) {
		throw new Error("Unsupported Telegram OIDC token header")
	}

	const jwk = jwks.keys.find((key) => key.kid === header.kid)
	if (!jwk) {
		throw new Error("Telegram OIDC signing key not found")
	}

	const cryptoKey = await crypto.subtle.importKey(
		"jwk",
		{ ...jwk, alg: "RS256" },
		{
			name: "RSASSA-PKCS1-v1_5",
			hash: "SHA-256",
		},
		false,
		["verify"],
	)

	const verified = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		cryptoKey,
		base64UrlToUint8Array(segments.signature),
		textEncoder.encode(`${segments.header}.${segments.payload}`),
	)

	if (!verified) {
		throw new Error("Telegram OIDC token signature verification failed")
	}
}

const validateClaims = (
	claims: TelegramOidcClaims,
	options: { issuer: string; clientId: string },
) => {
	const nowSeconds = Math.floor(Date.now() / 1000)
	if (claims.iss !== options.issuer) {
		throw new Error("Telegram OIDC issuer mismatch")
	}

	const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
	if (!audiences.includes(options.clientId)) {
		throw new Error("Telegram OIDC audience mismatch")
	}

	if (!claims.exp || claims.exp <= nowSeconds) {
		throw new Error("Telegram OIDC token expired")
	}

	if (claims.nbf && claims.nbf > nowSeconds) {
		throw new Error("Telegram OIDC token not yet valid")
	}
}

export const verifyTelegramOidcIdToken = async (idToken: string, options: { clientId: string }) => {
	const discovery = await getDiscovery()
	const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".")
	if (!encodedHeader || !encodedPayload || !encodedSignature) {
		throw new Error("Invalid Telegram OIDC id_token")
	}

	const header = decodeBase64UrlJson<TelegramOidcJwtHeader>(encodedHeader)
	const claims = decodeBase64UrlJson<TelegramOidcClaims>(encodedPayload)
	const jwks = await getJwks(discovery.jwks_uri)

	await verifyJwtSignature(
		{ header: encodedHeader, payload: encodedPayload, signature: encodedSignature },
		header,
		jwks,
	)
	validateClaims(claims, {
		issuer: discovery.issuer,
		clientId: options.clientId,
	})

	const telegramUserId = claims.sub?.trim()
	if (!telegramUserId) {
		throw new Error("Telegram OIDC token is missing subject")
	}

	const firstName =
		claims.given_name?.trim() || claims.name?.trim() || claims.preferred_username?.trim()
	if (!firstName) {
		throw new Error("Telegram OIDC token is missing a display name")
	}

	const email =
		claims.email?.trim().toLowerCase() || `telegram-${telegramUserId}@telegram.hiamby.invalid`

	return {
		id: telegramUserId,
		email,
		name:
			[claims.given_name, claims.family_name].filter(Boolean).join(" ").trim() ||
			claims.name?.trim() ||
			claims.preferred_username?.trim() ||
			firstName,
		first_name: claims.given_name?.trim() || firstName,
		last_name: claims.family_name?.trim() || undefined,
		username: claims.preferred_username?.trim() || undefined,
		phone_number: claims.phone_number?.trim() || undefined,
		photo_url: claims.picture?.trim() || claims.photo_url?.trim() || undefined,
		emailVerified: claims.email_verified ?? Boolean(claims.email),
	}
}

export const createTelegramOidcConfig = (options: {
	env: Pick<
		Env,
		| "TELEGRAM_BOT_TOKEN"
		| "TELEGRAM_OIDC_CLIENT_ID"
		| "TELEGRAM_OIDC_CLIENT_SECRET"
		| "TELEGRAM_OIDC_REQUEST_PHONE"
		| "TELEGRAM_OIDC_REQUEST_BOT_ACCESS"
	>
	telegramIdentity: Pick<TelegramIdentityServiceApi, "getSignInState">
}): GenericOAuthConfig | undefined => {
	const clientId = getTelegramOidcClientId(options.env)
	if (!clientId || !options.env.TELEGRAM_OIDC_CLIENT_SECRET) {
		return undefined
	}

	const scopes = ["openid", "profile"]
	if (options.env.TELEGRAM_OIDC_REQUEST_PHONE) {
		scopes.push("phone")
	}
	if (options.env.TELEGRAM_OIDC_REQUEST_BOT_ACCESS) {
		scopes.push("telegram:bot_access")
	}

	return {
		providerId: "telegram",
		discoveryUrl: TELEGRAM_OIDC_DISCOVERY_URL,
		clientId,
		clientSecret: options.env.TELEGRAM_OIDC_CLIENT_SECRET,
		scopes,
		pkce: true,
		getUserInfo: async (tokens) => {
			if (!tokens.idToken) {
				throw new Error("Telegram OIDC did not return an id_token")
			}
			const profile = await verifyTelegramOidcIdToken(tokens.idToken, { clientId })
			const signInState = await options.telegramIdentity.getSignInState(profile.id)
			if (signInState.status === "blocked") {
				return null
			}
			return profile
		},
		mapProfileToUser: async (profile) => ({
			name: typeof profile.name === "string" ? profile.name : undefined,
			email: typeof profile.email === "string" ? profile.email : undefined,
			image: typeof profile.photo_url === "string" ? profile.photo_url : undefined,
			telegramUsername: typeof profile.username === "string" ? profile.username : null,
			telegramPhoneNumber: typeof profile.phone_number === "string" ? profile.phone_number : null,
		}),
	}
}
