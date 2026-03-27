import { describe, expect, it } from "bun:test"
import {
	parseTelegramMiniAppProfile,
	parseTelegramWidgetProfile,
	verifyTelegramMiniAppInitData,
	verifyTelegramWidgetAuth,
} from "./verification"

const textEncoder = new TextEncoder()

const toHex = (bytes: Uint8Array) =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")

const hmacSha256Bytes = async (keyData: string | Uint8Array, message: string) => {
	const rawKey = typeof keyData === "string" ? textEncoder.encode(keyData) : keyData
	const key = await crypto.subtle.importKey(
		"raw",
		Uint8Array.from(rawKey).buffer,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	)
	const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message))
	return new Uint8Array(signature)
}

const sha256Bytes = async (value: string) =>
	new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)))

const signWidgetAuthData = async (authData: Record<string, string>, botToken: string) => {
	const dataCheckString = Object.entries(authData)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join("\n")
	const secret = await sha256Bytes(botToken)
	return toHex(await hmacSha256Bytes(secret, dataCheckString))
}

const signMiniAppInitData = async (initDataEntries: Record<string, string>, botToken: string) => {
	const dataCheckString = Object.entries(initDataEntries)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join("\n")
	const secret = await hmacSha256Bytes("WebAppData", botToken)
	return toHex(await hmacSha256Bytes(secret, dataCheckString))
}

describe("Telegram verification", () => {
	const botToken = "123456:test-token"

	it("verifies login widget auth data and parses the profile", async () => {
		const authData = {
			id: "42",
			first_name: "Dev",
			last_name: "Tester",
			username: "devtester",
			auth_date: String(Math.floor(Date.now() / 1000)),
			photo_url: "https://t.me/i/userpic/320/devtester.jpg",
		}

		const hash = await signWidgetAuthData(authData, botToken)
		await expect(
			verifyTelegramWidgetAuth(
				{
					...authData,
					hash,
				},
				{
					botToken,
					maxAuthAgeSeconds: 60,
				},
			),
		).resolves.toBeUndefined()

		expect(
			parseTelegramWidgetProfile({
				...authData,
				hash,
			}),
		).toEqual({
			id: "42",
			firstName: "Dev",
			lastName: "Tester",
			username: "devtester",
			photoUrl: "https://t.me/i/userpic/320/devtester.jpg",
		})
	})

	it("rejects expired widget auth data", async () => {
		const authData = {
			id: "42",
			first_name: "Dev",
			auth_date: String(Math.floor(Date.now() / 1000) - 3600),
		}
		const hash = await signWidgetAuthData(authData, botToken)
		await expect(
			verifyTelegramWidgetAuth(
				{
					...authData,
					hash,
				},
				{
					botToken,
					maxAuthAgeSeconds: 60,
				},
			),
		).rejects.toThrow("too old")
	})

	it("verifies mini app initData and parses the embedded user", async () => {
		const initDataEntries = {
			auth_date: String(Math.floor(Date.now() / 1000)),
			query_id: "AABBCC",
			user: JSON.stringify({
				id: 99,
				first_name: "Mini",
				last_name: "App",
				username: "miniapp",
				language_code: "en",
				is_premium: true,
				photo_url: "https://t.me/i/userpic/320/miniapp.jpg",
			}),
		}
		const hash = await signMiniAppInitData(initDataEntries, botToken)
		const initData = new URLSearchParams({
			...initDataEntries,
			hash,
		}).toString()

		const payload = await verifyTelegramMiniAppInitData(initData, {
			botToken,
			maxAuthAgeSeconds: 60,
		})

		expect(payload.user.id).toBe("99")
		expect(parseTelegramMiniAppProfile(payload)).toEqual({
			id: "99",
			firstName: "Mini",
			lastName: "App",
			username: "miniapp",
			languageCode: "en",
			isPremium: true,
			photoUrl: "https://t.me/i/userpic/320/miniapp.jpg",
		})
	})
})
