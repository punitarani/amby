import { NextRequest, NextResponse } from "next/server"
import { addMessage, addRequestLogEntry } from "../../../../lib/message-store"
import { emitSSE } from "../../../../lib/sse-emitter"

const botFrom = {
	id: 1,
	is_bot: true,
	first_name: "Amby",
	username: "amby_bot",
} as const

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ path: string[] }> },
) {
	const segments = (await params).path
	const method = segments.slice(1).join("/")

	let body: Record<string, unknown> = {}
	const contentType = request.headers.get("content-type") || ""
	if (contentType.includes("application/json")) {
		body = await request.json()
	} else if (contentType.includes("multipart/form-data")) {
		const formData = await request.formData()
		for (const [key, value] of formData.entries()) {
			body[key] = typeof value === "string" ? value : value.name
		}
	}

	addRequestLogEntry({
		direction: "inbound",
		method: "POST",
		url: `/api/mock-bot/${segments.join("/")}`,
		body,
	})

	const chatId = Number(body.chat_id) || 0
	const now = Math.floor(Date.now() / 1000)

	switch (method) {
		case "sendMessage": {
			const text = String(body.text || "")
			const msg = addMessage("bot", text)
			emitSSE("message", msg)
			return NextResponse.json({
				ok: true,
				result: {
					message_id: Number(msg.id),
					from: botFrom,
					chat: { id: chatId, type: "private" },
					date: now,
					text,
				},
			})
		}

		case "editMessageText": {
			const text = String(body.text || "")
			// Emit edit event for UI to update latest bot message
			emitSSE("edit", { text, message_id: body.message_id })
			return NextResponse.json({
				ok: true,
				result: {
					message_id: Number(body.message_id) || 0,
					from: botFrom,
					chat: { id: chatId, type: "private" },
					date: now,
					text,
					edit_date: now,
				},
			})
		}

		case "deleteMessage":
			emitSSE("delete", { message_id: Number(body.message_id) || 0 })
			return NextResponse.json({ ok: true, result: true })

		case "sendChatAction":
			emitSSE("typing", { chat_id: chatId, action: body.action })
			return NextResponse.json({ ok: true, result: true })

		case "setMyCommands":
			return NextResponse.json({ ok: true, result: true })

		case "getMe":
			return NextResponse.json({
				ok: true,
				result: {
					...botFrom,
					can_join_groups: true,
					can_read_all_group_messages: false,
					supports_inline_queries: false,
				},
			})

		default:
			console.log(`[mock-bot] Unhandled method: ${method}`, body)
			return NextResponse.json({ ok: true, result: {} })
	}
}
