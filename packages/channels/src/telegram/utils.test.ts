import { describe, expect, it } from "bun:test"
import { buildBufferedTelegramMessage, parseTelegramCommand } from "./utils"

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

describe("buildBufferedTelegramMessage", () => {
	it("builds an image-only message with a compact summary", () => {
		const buffered = buildBufferedTelegramMessage({
			message_id: 42,
			date: 1_710_000_000,
			chat: { id: 99, type: "private" },
			media_group_id: "album-1",
			photo: [
				{ file_id: "small", width: 100, height: 100, file_size: 1_000 },
				{ file_id: "large", width: 800, height: 600, file_size: 24_000 },
			],
		})

		expect(buffered).toEqual({
			sourceMessageId: 42,
			date: 1_710_000_000,
			textSummary: "User sent 1 image.",
			parts: [
				{
					type: "attachment",
					attachment: {
						kind: "image",
						mediaType: "image/jpeg",
						sizeBytes: 24_000,
						title: "Telegram photo",
						metadata: {
							width: 800,
							height: 600,
						},
						source: {
							kind: "telegram",
							telegramType: "photo",
							fileId: "large",
							fileUniqueId: null,
							chatId: 99,
							sourceMessageId: 42,
							mediaGroupId: "album-1",
							mediaType: "image/jpeg",
							sizeBytes: 24_000,
						},
					},
				},
			],
			mediaGroupId: "album-1",
			from: null,
			rawSource: {
				platform: "telegram",
				messageIds: [42],
			},
		})
	})

	it("keeps caption text and classifies PDFs as first-class attachments", () => {
		const buffered = buildBufferedTelegramMessage({
			message_id: 7,
			date: 1_710_000_123,
			caption: "Please review this",
			chat: { id: 55, type: "private" },
			document: {
				file_id: "pdf-file",
				file_unique_id: "pdf-unique",
				file_name: "spec.pdf",
				mime_type: "application/pdf",
				file_size: 32_768,
			},
		})

		expect(buffered?.textSummary).toBe("Please review this")
		expect(buffered?.parts).toEqual([
			{ type: "text", text: "Please review this" },
			{
				type: "attachment",
				attachment: {
					kind: "pdf",
					mediaType: "application/pdf",
					filename: "spec.pdf",
					sizeBytes: 32_768,
					title: "spec.pdf",
					source: {
						kind: "telegram",
						telegramType: "document",
						fileId: "pdf-file",
						fileUniqueId: "pdf-unique",
						chatId: 55,
						sourceMessageId: 7,
						mediaGroupId: null,
						mediaType: "application/pdf",
						filename: "spec.pdf",
						sizeBytes: 32_768,
					},
				},
			},
		])
	})

	it("treats markdown uploads as text documents for v1 direct handling", () => {
		const buffered = buildBufferedTelegramMessage({
			message_id: 11,
			date: 1_710_000_456,
			chat: { id: 123, type: "private" },
			document: {
				file_id: "doc-file",
				file_name: "notes.md",
				file_size: 512,
			},
		})

		expect(buffered?.textSummary).toBe("User sent 1 text document.")
		expect(buffered?.parts).toEqual([
			{
				type: "attachment",
				attachment: {
					kind: "text",
					mediaType: null,
					filename: "notes.md",
					sizeBytes: 512,
					title: "notes.md",
					source: {
						kind: "telegram",
						telegramType: "document",
						fileId: "doc-file",
						fileUniqueId: null,
						chatId: 123,
						sourceMessageId: 11,
						mediaGroupId: null,
						mediaType: null,
						filename: "notes.md",
						sizeBytes: 512,
					},
				},
			},
		])
	})
})
