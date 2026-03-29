import type { BufferedMessage } from "@amby/channels"
import {
	createInitialSessionState,
	type SessionState,
	type SessionStatus,
} from "./conversation-session-state"

interface LegacyBufferedMessage {
	text?: unknown
	messageId?: unknown
	date?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

function readSessionStatus(value: unknown): SessionStatus | null {
	return value === "idle" || value === "debouncing" || value === "processing" ? value : null
}

function readNullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null
}

function readNullableNumber(value: unknown): number | null {
	return typeof value === "number" ? value : null
}

function readLegacyBufferedMessage(value: unknown): BufferedMessage | null {
	if (!isRecord(value)) return null

	const messageId = readNullableNumber(value.messageId)
	const date = readNullableNumber(value.date)
	if (messageId === null || date === null) return null

	const text = typeof value.text === "string" ? value.text.trim() : ""
	return {
		sourceMessageId: messageId,
		date,
		textSummary: text,
		parts: text ? [{ type: "text", text }] : [],
		mediaGroupId: null,
		from: null,
		rawSource: {
			platform: "telegram",
			messageIds: [messageId],
		},
	}
}

function readBufferedMessage(value: unknown): BufferedMessage | null {
	if (!isRecord(value)) return null

	const sourceMessageId = readNullableNumber(value.sourceMessageId)
	const date = readNullableNumber(value.date)
	if (sourceMessageId !== null && date !== null && Array.isArray(value.parts)) {
		return {
			sourceMessageId,
			date,
			textSummary: typeof value.textSummary === "string" ? value.textSummary : "",
			parts: value.parts as BufferedMessage["parts"],
			mediaGroupId: typeof value.mediaGroupId === "string" ? value.mediaGroupId : null,
			from: isRecord(value.from) || value.from === null ? (value.from ?? null) : null,
			rawSource:
				isRecord(value.rawSource) || value.rawSource === null ? (value.rawSource ?? null) : null,
		}
	}

	return readLegacyBufferedMessage(value as LegacyBufferedMessage)
}

function readBufferedMessages(value: unknown): BufferedMessage[] {
	if (!Array.isArray(value)) return []

	return value.flatMap((entry) => {
		const parsed = readBufferedMessage(entry)
		return parsed ? [parsed] : []
	})
}

export function readPersistedSessionState(value: unknown): SessionState {
	const initial = createInitialSessionState()
	if (!isRecord(value)) return initial

	const state: SessionState = {
		status: readSessionStatus(value.status) ?? initial.status,
		userId: readNullableString(value.userId),
		conversationId: readNullableString(value.conversationId),
		chatId: readNullableNumber(value.chatId) ?? 0,
		buffer: readBufferedMessages(value.buffer),
		bufferStartedAt: readNullableNumber(value.bufferStartedAt),
		debounceDeadlineAt: readNullableNumber(value.debounceDeadlineAt),
		lastBufferedAt: readNullableNumber(value.lastBufferedAt),
		inFlightMessages: readBufferedMessages(value.inFlightMessages),
		activeWorkflowId: readNullableString(value.activeWorkflowId),
		activeExecutionToken: readNullableString(value.activeExecutionToken),
		activeExecutionStartedAt: readNullableNumber(value.activeExecutionStartedAt),
		firstOutboundClaimedAt: readNullableNumber(value.firstOutboundClaimedAt),
		supersededAt: readNullableNumber(value.supersededAt),
		supersedeReason: value.supersedeReason === "correction" ? "correction" : null,
		midRunFollowupCount: readNullableNumber(value.midRunFollowupCount) ?? 0,
	}

	if (state.status === "debouncing" && state.buffer.length === 0) {
		state.status = "idle"
		state.bufferStartedAt = null
		state.debounceDeadlineAt = null
	}

	if (state.status === "processing" && state.activeExecutionToken === null) {
		state.status = state.buffer.length > 0 ? "debouncing" : "idle"
		state.inFlightMessages = []
		state.activeWorkflowId = null
		state.activeExecutionStartedAt = null
		state.firstOutboundClaimedAt = null
		state.supersededAt = null
		state.supersedeReason = null
		state.midRunFollowupCount = 0
		if (state.status === "idle") {
			state.bufferStartedAt = null
			state.debounceDeadlineAt = null
		}
	}

	return state
}
