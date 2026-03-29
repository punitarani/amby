import { describe, expect, test } from "bun:test"
import {
	computeDebounceDeadline,
	isCorrectionMessage,
	DEBOUNCE_BASE_MS,
	DEBOUNCE_EXTEND_MS,
	DEBOUNCE_CAP_MS,
	RERUN_DEBOUNCE_MS,
} from "./conversation-session-logic"
import type { BufferedMessage } from "@amby/channels"

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function msg(text: string): BufferedMessage {
	return {
		sourceMessageId: 1,
		date: Date.now(),
		textSummary: text,
		parts: text ? [{ type: "text", text }] : [],
		mediaGroupId: null,
		from: null,
		rawSource: null,
	}
}

// ---------------------------------------------------------------------------
// isCorrectionMessage
// ---------------------------------------------------------------------------

describe("isCorrectionMessage", () => {
	const prefixes = [
		"wait",
		"actually",
		"sorry",
		"i meant",
		"ignore that",
		"correction",
		"to clarify",
		"instead",
	]

	for (const prefix of prefixes) {
		test(`matches prefix "${prefix}"`, () => {
			expect(isCorrectionMessage(msg(`${prefix} I need something else`))).toBe(true)
		})
	}

	test("matches with leading whitespace", () => {
		expect(isCorrectionMessage(msg("  actually no"))).toBe(true)
	})

	test("matches with mixed case", () => {
		expect(isCorrectionMessage(msg("ACTUALLY I changed my mind"))).toBe(true)
		expect(isCorrectionMessage(msg("Sorry, wrong question"))).toBe(true)
	})

	test("does not match unrelated text", () => {
		expect(isCorrectionMessage(msg("hello world"))).toBe(false)
		expect(isCorrectionMessage(msg("can you help me"))).toBe(false)
		expect(isCorrectionMessage(msg("also one more thing"))).toBe(false)
	})

	test("does not match partial word overlap", () => {
		expect(isCorrectionMessage(msg("waiting for the bus"))).toBe(true) // "wait" prefix
		expect(isCorrectionMessage(msg("sorrynotsorry hashtag"))).toBe(true) // "sorry" prefix
	})

	test("does not match empty text", () => {
		expect(isCorrectionMessage(msg(""))).toBe(false)
	})

	test("does not match attachment-only message", () => {
		const attachmentOnly: BufferedMessage = {
			sourceMessageId: 1,
			date: Date.now(),
			textSummary: "",
			parts: [
				{
					type: "attachment",
					attachment: {
						kind: "image",
						mediaType: "image/jpeg",
						filename: "photo.jpg",
						sizeBytes: 1024,
						title: null,
						metadata: {},
						source: {
							kind: "telegram",
							telegramType: "photo",
							fileId: "abc",
							chatId: 123,
							sourceMessageId: 1,
						},
					},
				},
			],
			mediaGroupId: null,
			from: null,
			rawSource: null,
		}
		expect(isCorrectionMessage(attachmentOnly)).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// computeDebounceDeadline
// ---------------------------------------------------------------------------

describe("computeDebounceDeadline", () => {
	const now = 10_000

	test("first message in window: returns now + DEBOUNCE_BASE_MS", () => {
		expect(computeDebounceDeadline(now, null, false)).toBe(now + DEBOUNCE_BASE_MS)
	})

	test("subsequent message: returns now + DEBOUNCE_EXTEND_MS", () => {
		const bufferStartedAt = now - 200
		const result = computeDebounceDeadline(now, bufferStartedAt, false)
		expect(result).toBe(now + DEBOUNCE_EXTEND_MS)
	})

	test("cap enforcement: caps at bufferStartedAt + DEBOUNCE_CAP_MS", () => {
		// bufferStartedAt far enough in the past that cap kicks in
		const bufferStartedAt = now - 1400
		const result = computeDebounceDeadline(now, bufferStartedAt, false)
		// min(bufferStartedAt + 1500, now + 400) = min(10100, 10400) = 10100
		expect(result).toBe(bufferStartedAt + DEBOUNCE_CAP_MS)
	})

	test("rerun: returns now + RERUN_DEBOUNCE_MS regardless of bufferStartedAt", () => {
		expect(computeDebounceDeadline(now, null, true)).toBe(now + RERUN_DEBOUNCE_MS)
		expect(computeDebounceDeadline(now, now - 500, true)).toBe(now + RERUN_DEBOUNCE_MS)
	})
})
