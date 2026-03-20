import { describe, expect, it } from "bun:test"
import { parseTelegramCommand } from "./utils"

describe("parseTelegramCommand", () => {
	it("parses bare supported commands", () => {
		expect(parseTelegramCommand("/start")).toEqual({
			command: "/start",
			payload: undefined,
			rawText: "/start",
		})
	})

	it("accepts commands addressed to this bot", () => {
		expect(parseTelegramCommand("/help@Amby_Bot", "amby_bot")).toEqual({
			command: "/help",
			payload: undefined,
			rawText: "/help@Amby_Bot",
		})
	})

	it("ignores commands addressed to another bot", () => {
		expect(parseTelegramCommand("/start@OtherBot payload", "amby_bot")).toBeUndefined()
	})

	it("keeps Telegram start payloads intact", () => {
		expect(parseTelegramCommand("/start connect-gmail", "amby_bot")).toEqual({
			command: "/start",
			payload: "connect-gmail",
			rawText: "/start connect-gmail",
		})
	})
})
