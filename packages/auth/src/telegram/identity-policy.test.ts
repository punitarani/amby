import { describe, expect, it } from "bun:test"
import { canSafelyUnlinkTelegram, getTelegramLinkConflict } from "./identity-policy"

describe("Telegram identity policy", () => {
	it("blocks unlink when Telegram is the only auth method", () => {
		expect(canSafelyUnlinkTelegram(1)).toBeFalse()
		expect(canSafelyUnlinkTelegram(0)).toBeFalse()
		expect(canSafelyUnlinkTelegram(2)).toBeTrue()
	})

	it("detects linking conflicts with another user", () => {
		expect(
			getTelegramLinkConflict({
				existingLinkedUserId: "user-b",
				currentUserId: "user-a",
				currentUserTelegramId: null,
				nextTelegramUserId: "tg-1",
			}),
		).toBe("telegram-linked-to-other-user")
	})

	it("detects when the current user already has a different telegram account", () => {
		expect(
			getTelegramLinkConflict({
				existingLinkedUserId: null,
				currentUserId: "user-a",
				currentUserTelegramId: "tg-old",
				nextTelegramUserId: "tg-new",
			}),
		).toBe("current-user-has-different-telegram")
	})

	it("allows idempotent relink of the same telegram account", () => {
		expect(
			getTelegramLinkConflict({
				existingLinkedUserId: "user-a",
				currentUserId: "user-a",
				currentUserTelegramId: "tg-1",
				nextTelegramUserId: "tg-1",
			}),
		).toBeNull()
	})
})
