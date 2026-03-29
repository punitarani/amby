import { DurableObject } from "cloudflare:workers"
import type { BufferedMessage, TelegramFrom } from "@amby/channels"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { setTelegramScope, setWorkerScope } from "../sentry"
import {
	beginProcessingState,
	type ClaimFirstOutboundInput,
	type ClaimFirstOutboundResult,
	type CompleteExecutionInput,
	type CompleteExecutionResult,
	claimFirstOutboundState,
	completeExecutionState,
	createInitialSessionState,
	handleProcessingFollowUpState,
	resetDebounceState,
	resetExecutionState,
	type SessionState,
	scheduleDebounceState,
	scheduleWorkflowRetryState,
	WORKFLOW_CREATE_RETRY_MS,
} from "./conversation-session-state"

interface IngestPayload {
	message: BufferedMessage
	chatId: number
	messageId: number
	date: number
	from: TelegramFrom
}

export type {
	ClaimFirstOutboundInput,
	ClaimFirstOutboundReason,
	ClaimFirstOutboundResult,
	CompleteExecutionInput,
	CompleteExecutionResult,
	ExecutionOutcome,
	SessionState,
	SessionStatus,
	SupersedeReason,
} from "./conversation-session-state"
export {
	computeDebounceDeadline,
	createInitialSessionState,
	getBufferedMessageText,
	INCREMENTAL_DEBOUNCE_MS,
	INITIAL_DEBOUNCE_MS,
	MAX_DEBOUNCE_WINDOW_MS,
	normalizeSupersessionText,
	RERUN_DEBOUNCE_MS,
	shouldSupersedeBufferedMessage,
	shouldSupersedeBufferedText,
	WORKFLOW_CREATE_RETRY_MS,
} from "./conversation-session-state"

export class ConversationSession extends DurableObject<WorkerBindings> {
	private state: SessionState = createInitialSessionState()

	private hydrated = false

	private async hydrate(): Promise<void> {
		if (this.hydrated) return
		const stored = await this.ctx.storage.get<SessionState>("state")
		if (stored) {
			this.state = stored
		}
		this.hydrated = true
	}

	private async persist(): Promise<void> {
		await this.ctx.storage.put("state", this.state)
	}

	private mergeBufferedMessages(
		existing: BufferedMessage,
		incoming: BufferedMessage,
	): BufferedMessage {
		const existingText = existing.parts.find((part) => part.type === "text")
		const incomingText = incoming.parts.find((part) => part.type === "text")
		const textSummary =
			existingText?.text.trim() || incomingText?.text.trim() || incoming.textSummary
		const existingRawIds = Array.isArray(existing.rawSource?.messageIds)
			? existing.rawSource.messageIds
			: [existing.sourceMessageId]
		const incomingRawIds = Array.isArray(incoming.rawSource?.messageIds)
			? incoming.rawSource.messageIds
			: [incoming.sourceMessageId]

		return {
			sourceMessageId: existing.sourceMessageId,
			date: Math.min(existing.date, incoming.date),
			textSummary,
			parts: [...existing.parts, ...incoming.parts],
			mediaGroupId: existing.mediaGroupId ?? incoming.mediaGroupId ?? null,
			from: existing.from ?? incoming.from ?? null,
			rawSource: {
				platform: "telegram",
				messageIds: [...existingRawIds, ...incomingRawIds],
			},
		}
	}

	private async scheduleDebounce(now: number, options?: { rerun?: boolean }) {
		const deadline = scheduleDebounceState(this.state, now, options)
		await this.ctx.storage.setAlarm(deadline)
	}

	private async scheduleWorkflowRetry(now: number) {
		const deadline = scheduleWorkflowRetryState(this.state, now)
		await this.ctx.storage.setAlarm(deadline)
	}

	async ingestMessage(payload: IngestPayload): Promise<void> {
		await this.hydrate()

		const now = Date.now()
		this.state.lastBufferedAt = now

		setTelegramScope({
			component: "conversation-session.ingest",
			chatId: payload.chatId,
			from: payload.from,
			userId: this.state.userId,
			conversationId: this.state.conversationId,
			attributes: {
				telegram_message_id: payload.messageId,
				buffered_message_count: this.state.buffer.length + 1,
				session_status: this.state.status,
				buffer_started_at: this.state.bufferStartedAt ?? undefined,
				debounce_deadline_at: this.state.debounceDeadlineAt ?? undefined,
				in_flight_message_count: this.state.inFlightMessages.length,
				first_outbound_claimed_at: this.state.firstOutboundClaimedAt ?? undefined,
				superseded_at: this.state.supersededAt ?? undefined,
				mid_run_followup_count: this.state.midRunFollowupCount,
			},
		})

		if (this.state.chatId === 0) {
			this.state.chatId = payload.chatId
		}

		await this.ctx.storage.put("pendingFrom", payload.from)

		const lastBuffered = this.state.buffer.at(-1)
		const bufferedMessage =
			lastBuffered?.mediaGroupId &&
			payload.message.mediaGroupId &&
			lastBuffered.mediaGroupId === payload.message.mediaGroupId
				? this.mergeBufferedMessages(lastBuffered, payload.message)
				: payload.message

		if (bufferedMessage === payload.message) {
			this.state.buffer.push(payload.message)
		} else {
			this.state.buffer[this.state.buffer.length - 1] = bufferedMessage
		}

		if (this.state.status === "processing") {
			handleProcessingFollowUpState(this.state, bufferedMessage, now)
			await this.persist()
			return
		}

		await this.scheduleDebounce(now)
		await this.persist()
	}

	async alarm(): Promise<void> {
		await this.hydrate()
		const pendingFrom = await this.ctx.storage.get<TelegramFrom>("pendingFrom")

		if (this.state.chatId) {
			setTelegramScope({
				component: "conversation-session.alarm",
				chatId: this.state.chatId,
				from: pendingFrom ?? null,
				userId: this.state.userId,
				conversationId: this.state.conversationId,
				attributes: {
					buffered_message_count: this.state.buffer.length,
					session_status: this.state.status,
					buffer_started_at: this.state.bufferStartedAt ?? undefined,
					debounce_deadline_at: this.state.debounceDeadlineAt ?? undefined,
					in_flight_message_count: this.state.inFlightMessages.length,
				},
			})
		} else {
			setWorkerScope("conversation-session.alarm", {
				buffered_message_count: this.state.buffer.length,
				session_status: this.state.status,
				buffer_started_at: this.state.bufferStartedAt ?? undefined,
				debounce_deadline_at: this.state.debounceDeadlineAt ?? undefined,
				in_flight_message_count: this.state.inFlightMessages.length,
			})
		}

		if (this.state.status !== "debouncing") {
			return
		}

		if (this.state.buffer.length === 0) {
			this.state.status = "idle"
			resetDebounceState(this.state)
			await this.persist()
			return
		}

		const messages = [...this.state.buffer]
		const executionToken = crypto.randomUUID()
		const executionStartedAt = Date.now()

		beginProcessingState({
			state: this.state,
			messages,
			executionToken,
			now: executionStartedAt,
		})
		await this.persist()

		const workflow = this.env.AGENT_WORKFLOW
		if (workflow) {
			try {
				const instance = await Sentry.startSpan(
					{
						op: "workflow.start",
						name: "AgentExecutionWorkflow.create",
					},
					() =>
						workflow.create({
							id: crypto.randomUUID(),
							params: {
								chatId: this.state.chatId,
								messages: this.state.inFlightMessages,
								userId: this.state.userId,
								from: pendingFrom ?? null,
								conversationId: this.state.conversationId,
								executionToken,
							},
						}),
				)
				this.state.activeWorkflowId = instance.id
				Sentry.logger.info("Conversation workflow started", {
					telegram_chat_id: this.state.chatId,
					buffered_message_count: messages.length,
					workflow_id: instance.id,
					execution_token: executionToken,
					execution_started_at: executionStartedAt,
				})
				await this.persist()
				return
			} catch (err) {
				Sentry.captureException(err)
				console.error("[DO] Failed to launch workflow:", err)
			}
		} else {
			console.error("[DO] AGENT_WORKFLOW binding not available")
		}

		this.state.buffer = [...this.state.inFlightMessages, ...this.state.buffer]
		this.state.status = "idle"
		resetExecutionState(this.state)
		await this.scheduleWorkflowRetry(Date.now())
		Sentry.logger.warn("Conversation workflow launch failed; scheduling retry", {
			telegram_chat_id: this.state.chatId,
			buffered_message_count: this.state.buffer.length,
			retry_delay_ms: WORKFLOW_CREATE_RETRY_MS,
		})
		await this.persist()
	}

	async claimFirstOutbound(input: ClaimFirstOutboundInput): Promise<ClaimFirstOutboundResult> {
		await this.hydrate()

		const result = claimFirstOutboundState(this.state, input, Date.now())
		if (result.allowed && result.reason === "ok") {
			await this.persist()
		}
		return result
	}

	async completeExecution(input: CompleteExecutionInput): Promise<CompleteExecutionResult> {
		await this.hydrate()
		setTelegramScope({
			component: "conversation-session.complete",
			chatId: this.state.chatId || undefined,
			userId: input.userId ?? this.state.userId,
			conversationId: input.conversationId ?? this.state.conversationId,
			attributes: {
				buffered_message_count: this.state.buffer.length,
				session_status: this.state.status,
				in_flight_message_count: this.state.inFlightMessages.length,
				first_outbound_claimed_at: this.state.firstOutboundClaimedAt ?? undefined,
				superseded_at: this.state.supersededAt ?? undefined,
				outcome: input.outcome,
			},
		})

		const result = completeExecutionState(this.state, input, Date.now())
		await this.persist()
		return result
	}
}
