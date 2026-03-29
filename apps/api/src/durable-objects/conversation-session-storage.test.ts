import { describe, expect, it } from "bun:test"
import { readPersistedSessionState } from "./conversation-session-storage"

describe("readPersistedSessionState", () => {
	it("migrates legacy buffered text messages into the current structured shape", () => {
		const state = readPersistedSessionState({
			status: "debouncing",
			userId: "user-1",
			conversationId: "conversation-1",
			chatId: 123,
			buffer: [{ text: "hello world", messageId: 9, date: 1_700_000_009 }],
			activeWorkflowId: "workflow-1",
		})

		expect(state.userId).toBe("user-1")
		expect(state.conversationId).toBe("conversation-1")
		expect(state.chatId).toBe(123)
		expect(state.buffer).toEqual([
			{
				sourceMessageId: 9,
				date: 1_700_000_009,
				textSummary: "hello world",
				parts: [{ type: "text", text: "hello world" }],
				mediaGroupId: null,
				from: null,
				rawSource: {
					platform: "telegram",
					messageIds: [9],
				},
			},
		])
		expect(state.inFlightMessages).toEqual([])
		expect(state.activeExecutionToken).toBeNull()
	})

	it("repairs legacy processing rows that do not have execution-token state", () => {
		const state = readPersistedSessionState({
			status: "processing",
			chatId: 123,
			buffer: [{ text: "follow up", messageId: 2, date: 1_700_000_002 }],
			activeWorkflowId: "workflow-1",
		})

		expect(state.status).toBe("debouncing")
		expect(state.activeWorkflowId).toBeNull()
		expect(state.inFlightMessages).toEqual([])
		expect(state.buffer).toEqual([
			{
				sourceMessageId: 2,
				date: 1_700_000_002,
				textSummary: "follow up",
				parts: [{ type: "text", text: "follow up" }],
				mediaGroupId: null,
				from: null,
				rawSource: {
					platform: "telegram",
					messageIds: [2],
				},
			},
		])
	})
})
