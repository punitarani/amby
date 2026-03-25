import { NextResponse } from "next/server"
import type { MockUserConfig } from "../../../lib/telegram-types"
import {
	addMessage,
	getMessages,
	addRequestLogEntry,
} from "../../../lib/message-store"
import { buildWebhookUpdate } from "../../../lib/webhook-builder"
import { emitSSE } from "../../../lib/sse-emitter"

export async function POST(request: Request) {
	const body = await request.json()
	const { text, user } = body as { text: string; user: MockUserConfig }

	if (!text || !user) {
		return NextResponse.json(
			{ error: "Missing text or user" },
			{ status: 400 },
		)
	}

	const userMsg = addMessage("user", text)
	emitSSE("message", userMsg)

	const update = buildWebhookUpdate(text, user, Number(userMsg.id))
	const webhookUrl = `${user.backendUrl}/api/telegram/webhook`

	addRequestLogEntry({
		direction: "outbound",
		method: "POST",
		url: webhookUrl,
		body: update,
	})

	try {
		const res = await fetch(webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Telegram-Bot-Api-Secret-Token": user.webhookSecret,
			},
			body: JSON.stringify(update),
		})

		const responseBody = await res.text()

		addRequestLogEntry({
			direction: "inbound",
			method: "POST",
			url: webhookUrl,
			body: update,
			response: { status: res.status, body: responseBody },
		})

		// Telegram webhook responses can include a sendMessage action
		try {
			const parsed = JSON.parse(responseBody)
			if (parsed.method === "sendMessage" && parsed.text) {
				const botMsg = addMessage("bot", parsed.text)
				emitSSE("message", botMsg)
			}
		} catch {
			/* response may not be JSON */
		}
	} catch (err) {
		addRequestLogEntry({
			direction: "inbound",
			method: "POST",
			url: webhookUrl,
			body: { error: String(err) },
		})
	}

	return NextResponse.json({ messages: getMessages() })
}
