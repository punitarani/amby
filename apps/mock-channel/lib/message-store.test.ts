import { describe, expect, it, beforeEach } from "bun:test"
import {
	addMessage,
	editMessage,
	deleteMessage,
	getMessages,
	addLogEntry,
	getRequestLog,
	clearStore,
} from "./message-store"

describe("message store", () => {
	beforeEach(() => clearStore())

	it("adds messages with incrementing IDs", () => {
		const m1 = addMessage({ chat_id: 1, text: "hello", from_bot: true, date: 123 })
		const m2 = addMessage({ chat_id: 1, text: "world", from_bot: true, date: 124 })
		expect(m2.message_id).toBe(m1.message_id + 1)
	})

	it("returns non-deleted messages", () => {
		addMessage({ chat_id: 1, text: "keep", from_bot: true, date: 1 })
		const m2 = addMessage({ chat_id: 1, text: "remove", from_bot: true, date: 2 })
		deleteMessage(m2.message_id)
		const msgs = getMessages()
		expect(msgs).toHaveLength(1)
		expect(msgs[0]?.text).toBe("keep")
	})

	it("edits existing messages", () => {
		const msg = addMessage({ chat_id: 1, text: "original", from_bot: true, date: 1 })
		const edited = editMessage(msg.message_id, "updated")
		expect(edited?.text).toBe("updated")
		expect(edited?.edited).toBe(true)
	})

	it("returns null when editing non-existent message", () => {
		expect(editMessage(99999, "nope")).toBeNull()
	})

	it("tracks request log entries", () => {
		addLogEntry({ direction: "outbound", method: "POST", url: "/test", body: {} })
		expect(getRequestLog()).toHaveLength(1)
	})

	it("clears all state", () => {
		addMessage({ chat_id: 1, text: "test", from_bot: true, date: 1 })
		addLogEntry({ direction: "outbound", method: "POST", url: "/test", body: {} })
		clearStore()
		expect(getMessages()).toHaveLength(0)
		expect(getRequestLog()).toHaveLength(0)
	})
})
