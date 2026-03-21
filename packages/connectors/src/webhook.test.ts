import { describe, expect, it } from "bun:test"
import {
	getExpiredConnectedAccountId,
	getTelegramChatId,
	getWebhookType,
	normalizeWebhookPayload,
} from "./webhook"

describe("normalizeWebhookPayload", () => {
	it("parses a JSON string into an object", () => {
		expect(normalizeWebhookPayload('{"type":"test"}')).toEqual({ type: "test" })
	})

	it("passes through an object", () => {
		const obj = { type: "test" }
		expect(normalizeWebhookPayload(obj)).toBe(obj)
	})

	it("returns undefined for invalid JSON", () => {
		expect(normalizeWebhookPayload("not json")).toBeUndefined()
	})

	it("returns undefined for null", () => {
		expect(normalizeWebhookPayload(null)).toBeUndefined()
	})

	it("returns undefined for undefined", () => {
		expect(normalizeWebhookPayload(undefined)).toBeUndefined()
	})

	it("returns undefined for arrays", () => {
		expect(normalizeWebhookPayload([1, 2, 3])).toBeUndefined()
	})

	it("returns undefined for JSON string containing an array", () => {
		expect(normalizeWebhookPayload("[1,2,3]")).toBeUndefined()
	})
})

describe("getWebhookType", () => {
	it("extracts type from top-level property", () => {
		expect(getWebhookType({ type: "composio.connected_account.expired" })).toBe(
			"composio.connected_account.expired",
		)
	})

	it("extracts type from event.type", () => {
		expect(getWebhookType({ event: { type: "composio.connected_account.expired" } })).toBe(
			"composio.connected_account.expired",
		)
	})

	it("prefers top-level type over event.type", () => {
		expect(getWebhookType({ type: "top", event: { type: "nested" } })).toBe("top")
	})

	it("returns undefined when missing", () => {
		expect(getWebhookType({})).toBeUndefined()
		expect(getWebhookType(null)).toBeUndefined()
	})

	it("works with JSON string input", () => {
		expect(getWebhookType('{"type":"test"}')).toBe("test")
	})
})

describe("getExpiredConnectedAccountId", () => {
	it("extracts from data.connectedAccountId", () => {
		expect(getExpiredConnectedAccountId({ data: { connectedAccountId: "ca_123" } })).toBe("ca_123")
	})

	it("extracts from data.connected_account_id", () => {
		expect(getExpiredConnectedAccountId({ data: { connected_account_id: "ca_456" } })).toBe(
			"ca_456",
		)
	})

	it("extracts from data.id", () => {
		expect(getExpiredConnectedAccountId({ data: { id: "ca_789" } })).toBe("ca_789")
	})

	it("extracts from connectedAccount.id nested in data", () => {
		expect(getExpiredConnectedAccountId({ data: { connectedAccount: { id: "ca_nested" } } })).toBe(
			"ca_nested",
		)
	})

	it("extracts from connected_account.id nested in data", () => {
		expect(getExpiredConnectedAccountId({ data: { connected_account: { id: "ca_snake" } } })).toBe(
			"ca_snake",
		)
	})

	it("extracts from top-level connectedAccountId", () => {
		expect(getExpiredConnectedAccountId({ connectedAccountId: "ca_top" })).toBe("ca_top")
	})

	it("extracts from top-level connected_account_id", () => {
		expect(getExpiredConnectedAccountId({ connected_account_id: "ca_top_snake" })).toBe(
			"ca_top_snake",
		)
	})

	it("extracts from top-level connectedAccount.id", () => {
		expect(getExpiredConnectedAccountId({ connectedAccount: { id: "ca_top_obj" } })).toBe(
			"ca_top_obj",
		)
	})

	it("returns undefined when missing", () => {
		expect(getExpiredConnectedAccountId({})).toBeUndefined()
		expect(getExpiredConnectedAccountId(null)).toBeUndefined()
	})
})

describe("getTelegramChatId", () => {
	it("returns a number chatId", () => {
		expect(getTelegramChatId({ chatId: 12345 })).toBe(12345)
	})

	it("parses a string chatId", () => {
		expect(getTelegramChatId({ chatId: "67890" })).toBe(67890)
	})

	it("returns undefined for missing chatId", () => {
		expect(getTelegramChatId({})).toBeUndefined()
	})

	it("returns undefined for non-object input", () => {
		expect(getTelegramChatId(null)).toBeUndefined()
		expect(getTelegramChatId(undefined)).toBeUndefined()
		expect(getTelegramChatId("string")).toBeUndefined()
	})

	it("returns undefined for non-finite number", () => {
		expect(getTelegramChatId({ chatId: Number.NaN })).toBeUndefined()
		expect(getTelegramChatId({ chatId: Number.POSITIVE_INFINITY })).toBeUndefined()
	})

	it("returns undefined for non-numeric string", () => {
		expect(getTelegramChatId({ chatId: "not-a-number" })).toBeUndefined()
	})
})
