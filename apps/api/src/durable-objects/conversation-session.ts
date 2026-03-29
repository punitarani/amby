import { DurableObject } from "cloudflare:workers"
import type { BufferedMessage, TelegramFrom } from "@amby/channels"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { setTelegramScope, setWorkerScope } from "../sentry"
import {
	computeDebounceDeadline,
	isCorrectionMessage,
	migrateBufferEntries,
} from "./conversation-session-logic"

export { isCorrectionMessage } from "./conversation-session-logic"

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface SessionState {
	status: "idle" | "debouncing" | "processing"
	userId: string | null
	conversationId: string | null
	chatId: number
	buffer: BufferedMessage[]
	activeWorkflowId: string | null
	// Adaptive debounce
	bufferStartedAt: number | null
	debounceDeadlineAt: number | null
	lastBufferedAt: number | null
	// Execution lifecycle
	inFlightMessages: BufferedMessage[]
	activeExecutionToken: string | null
	activeExecutionStartedAt: number | null
	firstOutboundClaimedAt: number | null
	// Supersession
	supersededAt: number | null
	midRunFollowupCount: number
}

interface IngestPayload {
	message: BufferedMessage
	chatId: number
	messageId: number
	date: number
	from: TelegramFrom
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

const DEFAULT_STATE: SessionState = {
	status: "idle",
	userId: null,
	conversationId: null,
	chatId: 0,
	buffer: [],
	activeWorkflowId: null,
	bufferStartedAt: null,
	debounceDeadlineAt: null,
	lastBufferedAt: null,
	inFlightMessages: [],
	activeExecutionToken: null,
	activeExecutionStartedAt: null,
	firstOutboundClaimedAt: null,
	supersededAt: null,
	midRunFollowupCount: 0,
}

// ---------------------------------------------------------------------------
// Durable Object
// ---------------------------------------------------------------------------

export class ConversationSession extends DurableObject<WorkerBindings> {
	private state: SessionState = { ...DEFAULT_STATE }
	private hydrated = false

	private async hydrate(): Promise<void> {
		if (this.hydrated) return
		const stored = await this.ctx.storage.get<SessionState>("state")
		if (stored) {
			this.state = { ...DEFAULT_STATE, ...stored }
			this.state.buffer = migrateBufferEntries(this.state.buffer)
			this.state.inFlightMessages = migrateBufferEntries(this.state.inFlightMessages ?? [])
		}
		this.hydrated = true
	}

	private async persist(): Promise<void> {
		await this.ctx.storage.put("state", this.state)
	}

	// -----------------------------------------------------------------------
	// State reset helpers
	// -----------------------------------------------------------------------

	private resetExecutionState(): void {
		this.state.inFlightMessages = []
		this.state.activeWorkflowId = null
		this.state.activeExecutionToken = null
		this.state.activeExecutionStartedAt = null
		this.state.firstOutboundClaimedAt = null
		this.state.supersededAt = null
		this.state.midRunFollowupCount = 0
	}

	private resetDebounceState(): void {
		this.state.bufferStartedAt = null
		this.state.debounceDeadlineAt = null
		this.state.lastBufferedAt = null
	}

	private async scheduleDebounce(now: number, isRerun: boolean): Promise<void> {
		this.state.bufferStartedAt = this.state.bufferStartedAt ?? now
		const deadline = computeDebounceDeadline(now, this.state.bufferStartedAt, isRerun)
		this.state.debounceDeadlineAt = deadline
		this.state.status = "debouncing"
		await this.ctx.storage.setAlarm(deadline)
	}

	// -----------------------------------------------------------------------
	// Media group merging
	// -----------------------------------------------------------------------

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

	private bufferMessage(message: BufferedMessage): void {
		const lastBuffered = this.state.buffer.at(-1)
		if (
			lastBuffered?.mediaGroupId &&
			message.mediaGroupId &&
			lastBuffered.mediaGroupId === message.mediaGroupId
		) {
			this.state.buffer[this.state.buffer.length - 1] = this.mergeBufferedMessages(
				lastBuffered,
				message,
			)
		} else {
			this.state.buffer.push(message)
		}
	}

	// -----------------------------------------------------------------------
	// RPCs
	// -----------------------------------------------------------------------

	async ingestMessage(payload: IngestPayload): Promise<void> {
		await this.hydrate()
		const now = Date.now()

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
				do_ingest_at: now,
			},
		})

		if (this.state.chatId === 0) {
			this.state.chatId = payload.chatId
		}

		await this.ctx.storage.put("pendingFrom", payload.from)
		this.bufferMessage(payload.message)

		if (this.state.status === "processing") {
			if (isCorrectionMessage(payload.message) && this.state.firstOutboundClaimedAt === null) {
				if (this.state.supersededAt === null) {
					this.state.supersededAt = now
				}
			} else {
				this.state.midRunFollowupCount++
			}
			await this.persist()
			return
		}

		this.state.lastBufferedAt = now
		await this.scheduleDebounce(now, false)
		await this.persist()
	}

	async alarm(): Promise<void> {
		await this.hydrate()
		const now = Date.now()
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
					debounce_started_at: this.state.bufferStartedAt ?? 0,
				},
			})
		} else {
			setWorkerScope("conversation-session.alarm", {
				buffered_message_count: this.state.buffer.length,
				session_status: this.state.status,
				debounce_started_at: this.state.bufferStartedAt ?? 0,
			})
		}

		if (this.state.buffer.length === 0) {
			this.state.status = "idle"
			this.resetDebounceState()
			await this.persist()
			return
		}

		// Move buffer into in-flight (preserved until accepted completion)
		const inFlight = this.state.buffer
		this.state.buffer = []
		this.resetExecutionState()
		this.state.inFlightMessages = inFlight
		const executionToken = crypto.randomUUID()
		this.state.activeExecutionToken = executionToken
		this.state.activeExecutionStartedAt = now
		this.state.status = "processing"
		this.resetDebounceState()

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
								executionToken,
							},
						}),
				)
				this.state.activeWorkflowId = instance.id
				Sentry.logger.info("Conversation workflow started", {
					telegram_chat_id: this.state.chatId,
					buffered_message_count: this.state.inFlightMessages.length,
					workflow_id: instance.id,
					execution_token: executionToken,
				})
			} catch (err) {
				Sentry.captureException(err)
				console.error("[DO] Failed to launch workflow:", err)
				this.state.buffer = [...this.state.inFlightMessages, ...this.state.buffer]
				this.resetExecutionState()
				this.state.status = "idle"
				await this.ctx.storage.setAlarm(Date.now() + 5000)
			}
		} else {
			console.error("[DO] AGENT_WORKFLOW binding not available")
			this.state.buffer = [...this.state.inFlightMessages, ...this.state.buffer]
			this.resetExecutionState()
			this.state.status = "idle"
			await this.ctx.storage.setAlarm(Date.now() + 5000)
		}

		await this.persist()
	}

	async claimFirstOutbound(params: {
		executionToken: string
	}): Promise<{ allowed: boolean; reason: "ok" | "stale" | "superseded" | "already-claimed" }> {
		await this.hydrate()
		if (params.executionToken !== this.state.activeExecutionToken) {
			return { allowed: false, reason: "stale" }
		}
		if (this.state.supersededAt !== null) {
			return { allowed: false, reason: "superseded" }
		}
		if (this.state.firstOutboundClaimedAt !== null) {
			return { allowed: false, reason: "already-claimed" }
		}
		this.state.firstOutboundClaimedAt = Date.now()
		await this.persist()
		return { allowed: true, reason: "ok" }
	}

	async completeExecution(result: {
		executionToken: string
		userId?: string
		conversationId?: string
	}): Promise<{ accepted: boolean; shouldRerun: boolean }> {
		await this.hydrate()
		const now = Date.now()

		setTelegramScope({
			component: "conversation-session.complete",
			chatId: this.state.chatId ?? undefined,
			userId: result.userId ?? this.state.userId,
			conversationId: result.conversationId ?? this.state.conversationId,
			attributes: {
				buffered_message_count: this.state.buffer.length,
				session_status: this.state.status,
				execution_completed_at: now,
			},
		})

		if (result.executionToken !== this.state.activeExecutionToken) {
			Sentry.logger.warn("Stale completion ignored", {
				expected_token: this.state.activeExecutionToken,
				received_token: result.executionToken,
			})
			return { accepted: false, shouldRerun: false }
		}

		if (result.userId) this.state.userId = result.userId
		if (result.conversationId) this.state.conversationId = result.conversationId

		if (this.state.supersededAt !== null) {
			this.state.buffer = [...this.state.inFlightMessages, ...this.state.buffer]
			this.resetExecutionState()
			await this.scheduleDebounce(now, true)
			await this.persist()
			Sentry.logger.info("Superseded execution completed, scheduling rerun", {
				telegram_chat_id: this.state.chatId,
				rerun_messages: this.state.buffer.length,
			})
			return { accepted: true, shouldRerun: true }
		}

		this.resetExecutionState()
		if (this.state.buffer.length > 0) {
			await this.scheduleDebounce(now, false)
		} else {
			this.state.status = "idle"
			this.resetDebounceState()
		}
		await this.persist()
		return { accepted: true, shouldRerun: false }
	}
}
