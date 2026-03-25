import { describe, expect, it, beforeEach } from "bun:test"
import {
	addMessage,
	editMessage,
	deleteMessage,
	getMessages,
	clearStore,
} from "../../../lib/message-store"
import { getEmitter } from "../../../lib/sse-emitter"

describe("mock bot API logic", () => {
	beforeEach(() => clearStore())

	it("sendMessage adds a bot message and returns it", () => {
		const msg = addMessage({
			chat_id: 42,
			text: "Hello from bot",
			from_bot: true,
			date: 1000,
		})
		expect(msg.message_id).toBe(1)
		expect(msg.chat_id).toBe(42)
		expect(msg.text).toBe("Hello from bot")
		expect(msg.from_bot).toBe(true)
	})

	it("editMessageText updates an existing message", () => {
		const msg = addMessage({
			chat_id: 42,
			text: "Original",
			from_bot: true,
			date: 1000,
		})
		const edited = editMessage(msg.message_id, "Updated text")
		expect(edited).not.toBeNull()
		expect(edited!.text).toBe("Updated text")
		expect(edited!.edit_date).toBeDefined()
	})

	it("editMessageText returns null for unknown message", () => {
		const edited = editMessage(999, "No such message")
		expect(edited).toBeNull()
	})

	it("deleteMessage removes the message from the store", () => {
		const msg = addMessage({
			chat_id: 42,
			text: "To delete",
			from_bot: true,
			date: 1000,
		})
		expect(getMessages()).toHaveLength(1)
		const deleted = deleteMessage(msg.message_id)
		expect(deleted).toBe(true)
		expect(getMessages()).toHaveLength(0)
	})

	it("deleteMessage returns false for unknown message", () => {
		expect(deleteMessage(999)).toBe(false)
	})

	it("emitter broadcasts events to subscribers", () => {
		const emitter = getEmitter()
		const received: { event: string; data: unknown }[] = []
		const unsub = emitter.subscribe((event, data) => {
			received.push({ event, data })
		})

		emitter.broadcast("message", { text: "test" })
		expect(received).toHaveLength(1)
		expect(received[0]!.event).toBe("message")

		unsub()
		emitter.broadcast("message", { text: "after unsub" })
		expect(received).toHaveLength(1)
	})

	it("sendMessage response matches Telegram format", () => {
		const msg = addMessage({
			chat_id: 42,
			text: "Hello",
			from_bot: true,
			date: 1000,
		})
		const response = {
			ok: true,
			result: {
				message_id: msg.message_id,
				from: {
					id: 1,
					is_bot: true,
					first_name: "Amby",
					username: "amby_bot",
				},
				chat: { id: 42, type: "private" },
				date: msg.date,
				text: msg.text,
			},
		}
		expect(response.ok).toBe(true)
		expect(response.result.from.is_bot).toBe(true)
		expect(response.result.message_id).toBeGreaterThan(0)
		expect(response.result.chat.type).toBe("private")
	})

	it("assigns incrementing message IDs", () => {
		const m1 = addMessage({
			chat_id: 1,
			text: "First",
			from_bot: true,
			date: 1000,
		})
		const m2 = addMessage({
			chat_id: 1,
			text: "Second",
			from_bot: true,
			date: 1001,
		})
		expect(m2.message_id).toBe(m1.message_id + 1)
	})
})
