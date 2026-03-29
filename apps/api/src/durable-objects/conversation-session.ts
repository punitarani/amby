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
import { readPersistedSessionState } from "./conversation-session-storage"

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
		const stored = await this.ctx.storage.get("state")
		if (stored) {
			this.state = readPersistedSessionState(stored)
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

	private async getActiveWorkflowState(): Promise<
		"active" | "completed-without-callback" | "missing"
	> {
		if (!this.state.activeWorkflowId || !this.env.AGENT_WORKFLOW) {
			return "missing"
		}

		try {
			const instance = await this.env.AGENT_WORKFLOW.get(this.state.activeWorkflowId)
			const status = await instance.status()
			if (
				status.status === "queued" ||
				status.status === "running" ||
				status.status === "waiting" ||
				status.status === "paused" ||
				status.status === "waitingForPause"
			) {
				return "active"
			}
			if (status.status === "complete") {
				return "completed-without-callback"
			}
		} catch (err) {
			Sentry.captureException(err)
			console.error("[DO] Failed to inspect workflow state:", err)
		}

		return "missing"
	}

	private async recoverMissingWorkflow(now: number) {
		this.state.buffer = [...this.state.inFlightMessages, ...this.state.buffer]
		this.state.status = "idle"
		resetExecutionState(this.state)
		await this.scheduleWorkflowRetry(now)
		await this.persist()
	}

	private async recoverMissingCompletion(now: number) {
		const hasBufferedFollowUps = this.state.buffer.length > 0
		this.state.status = "idle"
		resetExecutionState(this.state)

		if (hasBufferedFollowUps) {
			await this.scheduleDebounce(now, { rerun: true })
		} else {
			resetDebounceState(this.state)
			this.state.lastBufferedAt = null
		}

		await this.persist()
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
		const now = Date.now()

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

		if (this.state.status === "processing") {
			const workflowState = await this.getActiveWorkflowState()
			if (workflowState === "active") {
				return
			}
			if (workflowState === "completed-without-callback") {
				Sentry.logger.warn("Conversation workflow completed without DO callback; recovering", {
					telegram_chat_id: this.state.chatId,
					workflow_id: this.state.activeWorkflowId,
				})
				await this.recoverMissingCompletion(now)
				return
			}

			Sentry.logger.warn("Conversation workflow missing; restoring buffered messages", {
				telegram_chat_id: this.state.chatId,
				workflow_id: this.state.activeWorkflowId,
				buffered_message_count: this.state.buffer.length,
				in_flight_message_count: this.state.inFlightMessages.length,
			})
			await this.recoverMissingWorkflow(now)
			return
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
		const executionStartedAt = now
		const workflowId = crypto.randomUUID()

		beginProcessingState({
			state: this.state,
			messages,
			executionToken,
			now: executionStartedAt,
		})
		this.state.activeWorkflowId = workflowId
		await this.ctx.storage.setAlarm(executionStartedAt + WORKFLOW_CREATE_RETRY_MS)
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
							id: workflowId,
							params: {
								chatId: this.state.chatId,
								messages,
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

		await this.recoverMissingWorkflow(now)
		Sentry.logger.warn("Conversation workflow launch failed; scheduling retry", {
			telegram_chat_id: this.state.chatId,
			buffered_message_count: this.state.buffer.length,
			retry_delay_ms: WORKFLOW_CREATE_RETRY_MS,
		})
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
		const now = Date.now()
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

		const result = completeExecutionState(this.state, input, now)
		if (result.accepted && result.shouldRerun && this.state.debounceDeadlineAt !== null) {
			await this.ctx.storage.setAlarm(this.state.debounceDeadlineAt)
		}
		await this.persist()
		return result
	}
}
