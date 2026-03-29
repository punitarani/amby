import type { BufferedMessage } from "@amby/channels"

export type SessionStatus = "idle" | "debouncing" | "processing"
export type SupersedeReason = "correction"
export type ExecutionOutcome = "completed" | "failed" | "blocked"

export interface ClaimFirstOutboundInput {
	executionToken: string
}

export type ClaimFirstOutboundReason = "ok" | "stale" | "superseded" | "already-claimed"

export interface ClaimFirstOutboundResult {
	allowed: boolean
	reason: ClaimFirstOutboundReason
}

export interface CompleteExecutionInput {
	executionToken: string
	userId?: string
	conversationId?: string
	outcome: ExecutionOutcome
}

export interface CompleteExecutionResult {
	accepted: boolean
	shouldRerun: boolean
}

export interface SessionState {
	status: SessionStatus
	userId: string | null
	conversationId: string | null
	chatId: number
	buffer: BufferedMessage[]
	bufferStartedAt: number | null
	debounceDeadlineAt: number | null
	lastBufferedAt: number | null
	inFlightMessages: BufferedMessage[]
	activeWorkflowId: string | null
	activeExecutionToken: string | null
	activeExecutionStartedAt: number | null
	firstOutboundClaimedAt: number | null
	supersededAt: number | null
	supersedeReason: SupersedeReason | null
	midRunFollowupCount: number
}

export const INITIAL_DEBOUNCE_MS = 800
export const INCREMENTAL_DEBOUNCE_MS = 400
export const MAX_DEBOUNCE_WINDOW_MS = 1500
export const RERUN_DEBOUNCE_MS = 250
export const WORKFLOW_CREATE_RETRY_MS = 5000

const SUPERSSESSION_PREFIXES = [
	"wait",
	"actually",
	"sorry",
	"i meant",
	"ignore that",
	"correction",
	"to clarify",
	"instead",
] as const

const SUPERSESSION_PREFIX_RE = new RegExp(
	`^(?:${SUPERSSESSION_PREFIXES.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:\\b|[\\s,.:;!?-])`,
)

export function createInitialSessionState(): SessionState {
	return {
		status: "idle",
		userId: null,
		conversationId: null,
		chatId: 0,
		buffer: [],
		bufferStartedAt: null,
		debounceDeadlineAt: null,
		lastBufferedAt: null,
		inFlightMessages: [],
		activeWorkflowId: null,
		activeExecutionToken: null,
		activeExecutionStartedAt: null,
		firstOutboundClaimedAt: null,
		supersededAt: null,
		supersedeReason: null,
		midRunFollowupCount: 0,
	}
}

export function getBufferedMessageText(message: BufferedMessage): string {
	const text = message.parts
		.filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
		.map((part) => part.text.trim())
		.filter(Boolean)
		.join(" ")
	return text || message.textSummary || ""
}

export function normalizeSupersessionText(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, " ")
}

export function shouldSupersedeBufferedText(text: string): boolean {
	const normalized = normalizeSupersessionText(text)
	return normalized.length > 0 && SUPERSESSION_PREFIX_RE.test(normalized)
}

export function shouldSupersedeBufferedMessage(message: BufferedMessage): boolean {
	return shouldSupersedeBufferedText(getBufferedMessageText(message))
}

export function computeDebounceDeadline(params: {
	now: number
	bufferStartedAt: number
	bufferedCount: number
	rerun: boolean
}): number {
	if (params.rerun) {
		return params.now + RERUN_DEBOUNCE_MS
	}
	if (params.bufferedCount <= 1) {
		return params.now + INITIAL_DEBOUNCE_MS
	}
	return Math.min(
		params.bufferStartedAt + MAX_DEBOUNCE_WINDOW_MS,
		params.now + INCREMENTAL_DEBOUNCE_MS,
	)
}

export function resetDebounceState(state: SessionState) {
	state.bufferStartedAt = null
	state.debounceDeadlineAt = null
}

export function resetExecutionState(state: SessionState) {
	state.inFlightMessages = []
	state.activeWorkflowId = null
	state.activeExecutionToken = null
	state.activeExecutionStartedAt = null
	state.firstOutboundClaimedAt = null
	state.supersededAt = null
	state.supersedeReason = null
	state.midRunFollowupCount = 0
}

export function scheduleDebounceState(
	state: SessionState,
	now: number,
	options?: { rerun?: boolean },
) {
	state.status = "debouncing"
	state.bufferStartedAt = options?.rerun ? now : (state.bufferStartedAt ?? now)
	state.debounceDeadlineAt = computeDebounceDeadline({
		now,
		bufferStartedAt: state.bufferStartedAt,
		bufferedCount: state.buffer.length,
		rerun: options?.rerun ?? false,
	})
	return state.debounceDeadlineAt
}

export function scheduleWorkflowRetryState(state: SessionState, now: number) {
	state.status = "debouncing"
	state.bufferStartedAt = now
	state.debounceDeadlineAt = now + WORKFLOW_CREATE_RETRY_MS
	return state.debounceDeadlineAt
}

export function beginProcessingState(params: {
	state: SessionState
	messages: BufferedMessage[]
	executionToken: string
	now: number
}) {
	params.state.buffer = []
	params.state.inFlightMessages = params.messages
	params.state.status = "processing"
	params.state.activeExecutionToken = params.executionToken
	params.state.activeExecutionStartedAt = params.now
	params.state.firstOutboundClaimedAt = null
	params.state.supersededAt = null
	params.state.supersedeReason = null
	params.state.midRunFollowupCount = 0
	resetDebounceState(params.state)
}

export function handleProcessingFollowUpState(
	state: SessionState,
	message: BufferedMessage,
	now: number,
) {
	state.midRunFollowupCount += 1
	if (
		state.firstOutboundClaimedAt === null &&
		shouldSupersedeBufferedMessage(message) &&
		state.supersededAt === null
	) {
		state.supersededAt = now
		state.supersedeReason = "correction"
	}
}

export function claimFirstOutboundState(
	state: SessionState,
	input: ClaimFirstOutboundInput,
	now: number,
): ClaimFirstOutboundResult {
	if (state.activeExecutionToken !== input.executionToken) {
		return { allowed: false, reason: "stale" }
	}
	if (state.supersededAt !== null) {
		return { allowed: false, reason: "superseded" }
	}
	if (state.firstOutboundClaimedAt !== null) {
		return { allowed: true, reason: "already-claimed" }
	}
	state.firstOutboundClaimedAt = now
	return { allowed: true, reason: "ok" }
}

export function completeExecutionState(
	state: SessionState,
	input: CompleteExecutionInput,
	now: number,
): CompleteExecutionResult {
	if (state.activeExecutionToken !== input.executionToken) {
		return { accepted: false, shouldRerun: false }
	}

	if (input.userId) state.userId = input.userId
	if (input.conversationId) state.conversationId = input.conversationId

	if (state.supersededAt !== null) {
		state.buffer = [...state.inFlightMessages, ...state.buffer]
	}

	const shouldRerun = state.buffer.length > 0

	state.status = "idle"
	resetExecutionState(state)

	if (shouldRerun) {
		scheduleDebounceState(state, now, { rerun: true })
	} else {
		resetDebounceState(state)
		state.lastBufferedAt = null
	}

	return { accepted: true, shouldRerun }
}
