import { NextResponse } from "next/server"
import type { MockUserConfig } from "../../../lib/telegram-types"

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
	return toHex(await hmacSha256Bytes(await sha256Bytes(botToken), dataCheckString))
}

const signMiniAppInitData = async (initDataEntries: Record<string, string>, botToken: string) => {
	const dataCheckString = Object.entries(initDataEntries)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join("\n")
	const secret = await hmacSha256Bytes("WebAppData", botToken)
	return toHex(await hmacSha256Bytes(secret, dataCheckString))
}

export async function POST(request: Request) {
	const { user } = (await request.json()) as { user?: MockUserConfig }
	if (!user) {
		return NextResponse.json({ error: "Missing mock user config" }, { status: 400 })
	}

	const botToken = process.env.TELEGRAM_BOT_TOKEN
	if (!botToken) {
		return NextResponse.json(
			{ error: "TELEGRAM_BOT_TOKEN is not available in the mock app environment" },
			{ status: 503 },
		)
	}

	const authDate = String(Math.floor(Date.now() / 1000))
	const widgetAuthData = {
		id: String(user.telegramUserId),
		first_name: user.firstName,
		last_name: user.lastName ?? "",
		username: user.username ?? "",
		auth_date: authDate,
	}
	const widgetHash = await signWidgetAuthData(
		Object.fromEntries(Object.entries(widgetAuthData).filter(([, value]) => value !== "")),
		botToken,
	)

	const miniAppEntries = {
		auth_date: authDate,
		query_id: `mock-${crypto.randomUUID()}`,
		user: JSON.stringify({
			id: user.telegramUserId,
			first_name: user.firstName,
			last_name: user.lastName,
			username: user.username,
			language_code: "en",
			is_premium: false,
		}),
	}
	const miniAppHash = await signMiniAppInitData(miniAppEntries, botToken)

	return NextResponse.json({
		widgetAuthData: {
			...Object.fromEntries(Object.entries(widgetAuthData).filter(([, value]) => value !== "")),
			hash: widgetHash,
		},
		miniAppInitData: new URLSearchParams({
			...miniAppEntries,
			hash: miniAppHash,
		}).toString(),
	})
}
