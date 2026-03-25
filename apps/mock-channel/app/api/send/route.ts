import { NextRequest, NextResponse } from "next/server"
import { buildTelegramUpdate } from "../../../lib/webhook-builder"
import { addMessage, addLogEntry } from "../../../lib/message-store"
import { getBackendUrl, getWebhookSecret } from "../../../lib/config"
import type { MockUserConfig } from "../../../lib/telegram-types"

export async function POST(request: NextRequest) {
	const body = (await request.json()) as {
		text: string
		user: MockUserConfig
	}

	const { text, user } = body
	const trimmed = text?.trim()
	if (!trimmed) {
		return NextResponse.json({ error: "text is required" }, { status: 400 })
	}

	const update = buildTelegramUpdate({ text: trimmed, user })

	addMessage({
		chat_id: user.chatId,
		text: trimmed,
		from_bot: false,
		date: Math.floor(Date.now() / 1000),
	})

	const backendUrl = user.backendUrl || getBackendUrl()
	const webhookSecret = user.webhookSecret || getWebhookSecret()
	const webhookUrl = `${backendUrl}/telegram/webhook`

	const logEntry = addLogEntry({
		direction: "inbound",
		method: "POST",
		url: webhookUrl,
		body: update,
	})

	try {
		const response = await fetch(webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-telegram-bot-api-secret-token": webhookSecret,
			},
			body: JSON.stringify(update),
		})

		const responseBody = await response.text()

		logEntry.response = {
			status: response.status,
			body: responseBody,
		}

		return NextResponse.json({
			ok: true,
			webhookStatus: response.status,
			update,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)

		logEntry.response = {
			status: 0,
			body: { error: message },
		}

		return NextResponse.json(
			{ ok: false, error: `Failed to reach backend: ${message}` },
			{ status: 502 },
		)
	}
}
