import { describe, expect, it } from "bun:test"
import { parseReplyTarget } from "./reply-target"

describe("parseReplyTarget", () => {
	it("returns null for null", () => {
		expect(parseReplyTarget(null)).toBeNull()
	})

	it("returns null for non-object", () => {
		expect(parseReplyTarget("string")).toBeNull()
		expect(parseReplyTarget(42)).toBeNull()
		expect(parseReplyTarget(undefined)).toBeNull()
	})

	it("parses telegram with valid chatId", () => {
		expect(parseReplyTarget({ channel: "telegram", chatId: 12345 })).toEqual({
			channel: "telegram",
			chatId: 12345,
		})
	})

	it("returns null for telegram with NaN chatId", () => {
		expect(parseReplyTarget({ channel: "telegram", chatId: NaN })).toBeNull()
	})

	it("returns null for telegram with missing chatId", () => {
		expect(parseReplyTarget({ channel: "telegram" })).toBeNull()
	})

	it("returns null for unknown channel", () => {
		expect(parseReplyTarget({ channel: "unknown" })).toBeNull()
	})
})
