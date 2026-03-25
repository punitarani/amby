import { describe, expect, it, beforeEach } from "bun:test"
import { buildWebhookUpdate, resetCounters } from "./webhook-builder"
import type { MockUserConfig } from "./telegram-types"

const mockUser: MockUserConfig = {
	telegramUserId: 12345,
	firstName: "Test",
	lastName: "User",
	username: "testuser",
	chatId: 67890,
	backendUrl: "http://localhost:3001",
	webhookSecret: "test-secret",
}

describe("buildWebhookUpdate", () => {
	beforeEach(() => resetCounters())

	it("produces a valid TelegramUpdate shape", () => {
		const update = buildWebhookUpdate("hello", mockUser)
		expect(update.update_id).toBeGreaterThan(0)
		expect(update.message).toBeDefined()
		expect(update.message?.text).toBe("hello")
		expect(update.message?.from?.id).toBe(12345)
		expect(update.message?.chat.id).toBe(67890)
		expect(update.message?.chat.type).toBe("private")
	})

	it("increments update_id and message_id on successive calls", () => {
		const first = buildWebhookUpdate("a", mockUser)
		const second = buildWebhookUpdate("b", mockUser)
		expect(second.update_id).toBe(first.update_id + 1)
		expect(second.message?.message_id).toBe((first.message?.message_id ?? 0) + 1)
	})

	it("sets date to current Unix timestamp", () => {
		const before = Math.floor(Date.now() / 1000)
		const update = buildWebhookUpdate("test", mockUser)
		const after = Math.floor(Date.now() / 1000)
		expect(update.message?.date).toBeGreaterThanOrEqual(before)
		expect(update.message?.date).toBeLessThanOrEqual(after)
	})

	it("includes user identity fields", () => {
		const update = buildWebhookUpdate("hi", mockUser)
		const from = update.message?.from
		expect(from?.first_name).toBe("Test")
		expect(from?.last_name).toBe("User")
		expect(from?.username).toBe("testuser")
		expect(from?.is_bot).toBe(false)
		expect(from?.language_code).toBe("en")
	})

	it("works without optional user fields", () => {
		const minimalUser: MockUserConfig = {
			telegramUserId: 99,
			firstName: "Min",
			chatId: 100,
			backendUrl: "http://localhost:3001",
			webhookSecret: "s",
		}
		const update = buildWebhookUpdate("test", minimalUser)
		expect(update.message?.from?.first_name).toBe("Min")
		expect(update.message?.from?.last_name).toBeUndefined()
	})
})
