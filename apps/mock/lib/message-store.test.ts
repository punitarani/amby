import { describe, expect, it, beforeEach } from "bun:test"
import {
	addMessage,
	clearMessages,
	getMessages,
	addRequestLogEntry,
	getRequestLog,
	clearRequestLog,
} from "./message-store"

describe("message store", () => {
	beforeEach(() => {
		clearMessages()
		clearRequestLog()
	})

	it("adds messages with incrementing IDs", () => {
		const m1 = addMessage("user", "hello")
		const m2 = addMessage("bot", "hi there")
		expect(Number(m2.id)).toBe(Number(m1.id) + 1)
	})

	it("stores role correctly", () => {
		const user = addMessage("user", "question")
		const bot = addMessage("bot", "answer")
		expect(user.role).toBe("user")
		expect(bot.role).toBe("bot")
	})

	it("returns all messages in order", () => {
		addMessage("user", "first")
		addMessage("bot", "second")
		addMessage("user", "third")
		const msgs = getMessages()
		expect(msgs).toHaveLength(3)
		expect(msgs[0]?.text).toBe("first")
		expect(msgs[2]?.text).toBe("third")
	})

	it("clears messages", () => {
		addMessage("user", "test")
		clearMessages()
		expect(getMessages()).toHaveLength(0)
	})

	it("tracks request log entries", () => {
		addRequestLogEntry({ direction: "outbound", method: "POST", url: "/test", body: {} })
		expect(getRequestLog()).toHaveLength(1)
		expect(getRequestLog()[0]?.direction).toBe("outbound")
	})

	it("clears request log", () => {
		addRequestLogEntry({ direction: "outbound", method: "POST", url: "/test", body: {} })
		clearRequestLog()
		expect(getRequestLog()).toHaveLength(0)
	})

	it("assigns UUID ids to log entries", () => {
		const entry = addRequestLogEntry({ direction: "inbound", method: "GET", url: "/x", body: {} })
		expect(entry.id).toMatch(/^[0-9a-f-]+$/)
		expect(entry.timestamp).toBeGreaterThan(0)
	})
})
