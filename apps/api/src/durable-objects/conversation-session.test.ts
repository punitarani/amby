import { describe, expect, it } from "bun:test"
import type { BufferedMessage } from "@amby/channels"
import {
	beginProcessingState,
	claimFirstOutboundState,
	completeExecutionState,
	computeDebounceDeadline,
	createInitialSessionState,
	handleProcessingFollowUpState,
	INCREMENTAL_DEBOUNCE_MS,
	INITIAL_DEBOUNCE_MS,
	MAX_DEBOUNCE_WINDOW_MS,
	RERUN_DEBOUNCE_MS,
	type SessionState,
	scheduleDebounceState,
	shouldSupersedeBufferedText,
} from "./conversation-session-state"

function makeBufferedMessage(text: string, messageId: number): BufferedMessage {
	return {
		sourceMessageId: messageId,
		date: 1_700_000_000 + messageId,
		textSummary: text,
		parts: [{ type: "text", text }],
		mediaGroupId: null,
		from: null,
		rawSource: {
			platform: "telegram",
			messageIds: [messageId],
		},
	}
}

function createBufferedState(messages: string[]): SessionState {
	const state = createInitialSessionState()
	state.chatId = 456
	state.buffer = messages.map((text, index) => makeBufferedMessage(text, index + 1))
	return state
}

describe("conversation session debounce helpers", () => {
	it("computes the adaptive debounce deadline", () => {
		expect(
			computeDebounceDeadline({
				now: 1_000,
				bufferStartedAt: 1_000,
				bufferedCount: 1,
				rerun: false,
			}),
		).toBe(1_000 + INITIAL_DEBOUNCE_MS)

		expect(
			computeDebounceDeadline({
				now: 1_100,
				bufferStartedAt: 1_000,
				bufferedCount: 2,
				rerun: false,
			}),
		).toBe(Math.min(1_000 + MAX_DEBOUNCE_WINDOW_MS, 1_100 + INCREMENTAL_DEBOUNCE_MS))

		expect(
			computeDebounceDeadline({
				now: 1_200,
				bufferStartedAt: 1_000,
				bufferedCount: 3,
				rerun: true,
			}),
		).toBe(1_200 + RERUN_DEBOUNCE_MS)
	})

	it("matches only the narrow correction prefixes", () => {
		expect(shouldSupersedeBufferedText("actually use March")).toBe(true)
		expect(shouldSupersedeBufferedText("  i meant the second invoice")).toBe(true)
		expect(shouldSupersedeBufferedText("also one more thing")).toBe(false)
		expect(shouldSupersedeBufferedText("new topic entirely")).toBe(false)
	})
})

describe("conversation session state transitions", () => {
	it("uses adaptive debounce deadlines for buffered messages", () => {
		const state = createBufferedState(["first"])

		const initialDeadline = scheduleDebounceState(state, 1_000)
		expect(state.status).toBe("debouncing")
		expect(state.bufferStartedAt).toBe(1_000)
		expect(initialDeadline).toBe(1_000 + INITIAL_DEBOUNCE_MS)
		expect(state.debounceDeadlineAt).toBe(initialDeadline)

		state.buffer.push(makeBufferedMessage("second", 2))

		const secondDeadline = scheduleDebounceState(state, 1_100)
		expect(state.bufferStartedAt).toBe(1_000)
		expect(secondDeadline).toBe(1_500)
		expect(state.debounceDeadlineAt).toBe(1_500)
	})

	it("moves the buffered turn into in-flight state when execution starts", () => {
		const state = createBufferedState(["first", "second"])
		const bufferedMessages = [...state.buffer]

		beginProcessingState({
			state,
			messages: bufferedMessages,
			executionToken: "token-1",
			now: 2_500,
		})

		expect(state.status).toBe("processing")
		expect(state.buffer).toEqual([])
		expect(state.inFlightMessages).toEqual(bufferedMessages)
		expect(state.activeExecutionToken).toBe("token-1")
		expect(state.activeExecutionStartedAt).toBe(2_500)
	})

	it("marks a pre-first-outbound correction as superseding while preserving the active turn", () => {
		const state = createBufferedState(["draft the reply"])

		beginProcessingState({
			state,
			messages: [...state.buffer],
			executionToken: "token-1",
			now: 3_000,
		})

		const correction = makeBufferedMessage("actually mention the March date", 2)
		state.buffer.push(correction)
		handleProcessingFollowUpState(state, correction, 3_100)

		expect(state.inFlightMessages).toEqual([makeBufferedMessage("draft the reply", 1)])
		expect(state.buffer).toEqual([correction])
		expect(state.supersedeReason).toBe("correction")
		expect(state.supersededAt).toBe(3_100)
		expect(state.midRunFollowupCount).toBe(1)
	})

	it("queues ambiguous mid-run follow-ups without superseding", () => {
		const state = createBufferedState(["draft the reply"])

		beginProcessingState({
			state,
			messages: [...state.buffer],
			executionToken: "token-1",
			now: 4_000,
		})

		const followUp = makeBufferedMessage("new topic entirely", 2)
		state.buffer.push(followUp)
		handleProcessingFollowUpState(state, followUp, 4_050)

		expect(state.supersededAt).toBeNull()
		expect(state.buffer).toEqual([followUp])
	})

	it("queues even correction-shaped follow-ups after first outbound is claimed", () => {
		const state = createBufferedState(["draft the reply"])

		beginProcessingState({
			state,
			messages: [...state.buffer],
			executionToken: "token-1",
			now: 5_000,
		})

		const firstClaim = claimFirstOutboundState(state, { executionToken: "token-1" }, 5_025)
		expect(firstClaim).toEqual({ allowed: true, reason: "ok" })

		const followUp = makeBufferedMessage("actually mention March", 2)
		state.buffer.push(followUp)
		handleProcessingFollowUpState(state, followUp, 5_100)

		expect(state.firstOutboundClaimedAt).toBe(5_025)
		expect(state.supersededAt).toBeNull()
		expect(state.buffer).toEqual([followUp])
	})

	it("ignores stale completion tokens", () => {
		const state = createBufferedState(["draft the reply"])

		beginProcessingState({
			state,
			messages: [...state.buffer],
			executionToken: "token-1",
			now: 6_000,
		})

		const before = structuredClone(state)
		const result = completeExecutionState(
			state,
			{
				executionToken: "stale-token",
				outcome: "completed",
			},
			6_050,
		)

		expect(result).toEqual({ accepted: false, shouldRerun: false })
		expect(state).toEqual(before)
	})

	it("reruns a superseded turn with the original in-flight turn plus the correction", () => {
		const state = createBufferedState(["draft the reply"])

		beginProcessingState({
			state,
			messages: [...state.buffer],
			executionToken: "token-1",
			now: 7_000,
		})

		const correction = makeBufferedMessage("actually mention March", 2)
		state.buffer.push(correction)
		handleProcessingFollowUpState(state, correction, 7_050)

		const result = completeExecutionState(
			state,
			{
				executionToken: "token-1",
				userId: "user-1",
				conversationId: "conversation-1",
				outcome: "completed",
			},
			7_100,
		)

		expect(result).toEqual({ accepted: true, shouldRerun: true })
		expect(state.status).toBe("debouncing")
		expect(state.userId).toBe("user-1")
		expect(state.conversationId).toBe("conversation-1")
		expect(state.buffer).toEqual([
			makeBufferedMessage("draft the reply", 1),
			makeBufferedMessage("actually mention March", 2),
		])
		expect(state.debounceDeadlineAt).toBe(7_100 + RERUN_DEBOUNCE_MS)
		expect(state.activeExecutionToken).toBeNull()
		expect(state.inFlightMessages).toEqual([])
	})
})
