import { NextRequest, NextResponse } from "next/server"
import {
	addMessage,
	editMessage,
	deleteMessage,
	addLogEntry,
} from "../../../../lib/message-store"
import { getEmitter } from "../../../../lib/sse-emitter"

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

	addLogEntry({
		direction: "outbound",
		method: "POST",
		url: `/api/mock-bot/${segments.join("/")}`,
		body,
	})

	const emitter = getEmitter()
	const chatId = Number(body.chat_id) || 0
	const botFrom = {
		id: 1,
		is_bot: true,
		first_name: "Amby",
		username: "amby_bot",
	} as const

	switch (method) {
		case "sendMessage": {
			const text = String(body.text || "")
			const msg = addMessage({
				chat_id: chatId,
				text,
				from_bot: true,
				date: Math.floor(Date.now() / 1000),
			})
			emitter.broadcast("message", msg)
			return NextResponse.json({
				ok: true,
				result: {
					message_id: msg.message_id,
					from: botFrom,
					chat: { id: chatId, type: "private" },
					date: msg.date,
					text: msg.text,
				},
			})
		}

		case "editMessageText": {
			const messageId = Number(body.message_id) || 0
			const text = String(body.text || "")
			const edited = editMessage(messageId, text)
			if (edited) {
				emitter.broadcast("edit", edited)
			}
			const now = Math.floor(Date.now() / 1000)
			return NextResponse.json({
				ok: true,
				result: {
					message_id: messageId,
					from: botFrom,
					chat: { id: chatId, type: "private" },
					date: now,
					text,
					edit_date: now,
				},
			})
		}

		case "deleteMessage": {
			const messageId = Number(body.message_id) || 0
			deleteMessage(messageId)
			emitter.broadcast("delete", { message_id: messageId, chat_id: chatId })
			return NextResponse.json({ ok: true, result: true })
		}

		case "sendChatAction": {
			emitter.broadcast("typing", {
				chat_id: chatId,
				action: body.action,
			})
			return NextResponse.json({ ok: true, result: true })
		}

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
