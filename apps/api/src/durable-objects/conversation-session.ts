import { DurableObject } from "cloudflare:workers"
import type { BufferedMessage, TelegramFrom } from "@amby/channels"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { setTelegramScope, setWorkerScope } from "../sentry"

interface SessionState {
	status: "idle" | "debouncing" | "processing"
	userId: string | null
	conversationId: string | null
	chatId: number
	buffer: BufferedMessage[]
	activeWorkflowId: string | null
}

interface IngestPayload {
	message: BufferedMessage
	chatId: number
	messageId: number
	date: number
	from: TelegramFrom
}

const DEBOUNCE_MS = 3000
const ACTIVE_DEBOUNCE_MS = 1000

export class AmbyConversation extends DurableObject<WorkerBindings> {
	private state: SessionState = {
		status: "idle",
		userId: null,
		conversationId: null,
		chatId: 0,
		buffer: [],
		activeWorkflowId: null,
	}

	private hydrated = false

	private async hydrate(): Promise<void> {
		if (this.hydrated) return
		const stored = await this.ctx.storage.get<SessionState>("state")
		if (stored) {
			this.state = stored
			// Migrate legacy buffer entries (pre-attachment format)
			this.state.buffer = this.state.buffer.map((entry) => {
				const raw = entry as unknown as Record<string, unknown>
				if ("text" in raw && !("parts" in raw)) {
					return {
						sourceMessageId: (raw.messageId as number) ?? 0,
						date: (raw.date as number) ?? 0,
						textSummary: (raw.text as string) ?? "",
						parts: raw.text ? [{ type: "text" as const, text: raw.text as string }] : [],
						mediaGroupId: null,
						from: null,
						rawSource: null,
					} satisfies BufferedMessage
				}
				return entry
			})
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

	async ingestMessage(payload: IngestPayload): Promise<void> {
		await this.hydrate()
		setTelegramScope({
			component: "amby_conversation.ingest",
			chatId: payload.chatId,
			from: payload.from,
			userId: this.state.userId,
			conversationId: this.state.conversationId,
			attributes: {
				telegram_message_id: payload.messageId,
				buffered_message_count: this.state.buffer.length + 1,
				session_status: this.state.status,
			},
		})

		// Initialize chatId on first message
		if (this.state.chatId === 0) {
			this.state.chatId = payload.chatId
		}

		// Always store from info so the workflow can re-resolve the user if needed
		await this.ctx.storage.put("pendingFrom", payload.from)

		// Buffer the message
		const lastBuffered = this.state.buffer.at(-1)
		if (
			lastBuffered?.mediaGroupId &&
			payload.message.mediaGroupId &&
			lastBuffered.mediaGroupId === payload.message.mediaGroupId
		) {
			this.state.buffer[this.state.buffer.length - 1] = this.mergeBufferedMessages(
				lastBuffered,
				payload.message,
			)
		} else {
			this.state.buffer.push(payload.message)
		}

		if (this.state.status === "processing") {
			// Agent is already running — forward as interrupt to the active workflow
			if (this.state.activeWorkflowId && this.env.AMBY_AGENT_EXECUTION) {
				try {
					const instance = await this.env.AMBY_AGENT_EXECUTION.get(this.state.activeWorkflowId)
					await Sentry.startSpan(
						{
							op: "workflow.event",
							name: "amby_AgentExecution.sendEvent",
						},
						async () => {
							await instance.sendEvent({
								type: "user-message",
								payload: { message: payload.message, messageId: payload.messageId },
							})
						},
					)
				} catch (err) {
					Sentry.captureException(err)
					console.error("[DO] Failed to send event to workflow:", err)
				}
			}
			await this.persist()
			return
		}

		// Set or reset the debounce alarm
		this.state.status = "debouncing"
		await this.ctx.storage.setAlarm(Date.now() + DEBOUNCE_MS)
		await this.persist()
	}

	async alarm(): Promise<void> {
		await this.hydrate()
		const pendingFrom = await this.ctx.storage.get<TelegramFrom>("pendingFrom")
		if (this.state.chatId) {
			setTelegramScope({
				component: "amby_conversation.alarm",
				chatId: this.state.chatId,
				from: pendingFrom ?? null,
				userId: this.state.userId,
				conversationId: this.state.conversationId,
				attributes: {
					buffered_message_count: this.state.buffer.length,
					session_status: this.state.status,
				},
			})
		} else {
			setWorkerScope("amby_conversation.alarm", {
				buffered_message_count: this.state.buffer.length,
				session_status: this.state.status,
			})
		}

		if (this.state.buffer.length === 0) {
			this.state.status = "idle"
			await this.persist()
			return
		}

		// Resolve userId if not yet resolved
		if (!this.state.userId) {
			if (pendingFrom) {
				// userId resolution requires Effect runtime — we'll do it in the workflow
				// For now, store the from data and let the workflow resolve it
			}
		}

		// Drain the buffer
		const messages = [...this.state.buffer]
		this.state.buffer = []
		this.state.status = "processing"

		// Launch the workflow
		const workflow = this.env.AMBY_AGENT_EXECUTION
		if (workflow) {
			try {
				const instance = await Sentry.startSpan(
					{
						op: "workflow.start",
						name: "amby_AgentExecution.create",
					},
					() =>
						workflow.create({
							id: crypto.randomUUID(),
							params: {
								chatId: this.state.chatId,
								messages,
								userId: this.state.userId,
								from: pendingFrom ?? null,
							},
						}),
				)
				this.state.activeWorkflowId = instance.id
				Sentry.logger.info("Conversation workflow started", {
					telegram_chat_id: this.state.chatId,
					buffered_message_count: messages.length,
					workflow_id: instance.id,
				})
			} catch (err) {
				Sentry.captureException(err)
				console.error("[DO] Failed to launch workflow:", err)
				// Put messages back in buffer and retry
				this.state.buffer = [...messages, ...this.state.buffer]
				this.state.status = "idle"
				await this.ctx.storage.setAlarm(Date.now() + 5000)
			}
		} else {
			console.error("[DO] AMBY_AGENT_EXECUTION binding not available")
			this.state.status = "idle"
		}

		await this.persist()
	}

	async completeExecution(result: { userId?: string; conversationId?: string }): Promise<void> {
		await this.hydrate()
		setTelegramScope({
			component: "amby_conversation.complete",
			chatId: this.state.chatId ?? undefined,
			userId: result.userId ?? this.state.userId,
			conversationId: result.conversationId ?? this.state.conversationId,
			attributes: {
				buffered_message_count: this.state.buffer.length,
				session_status: this.state.status,
			},
		})

		// Cache resolved IDs from the workflow
		if (result.userId) this.state.userId = result.userId
		if (result.conversationId) this.state.conversationId = result.conversationId

		this.state.activeWorkflowId = null
		this.state.status = "idle"

		// If new messages arrived during processing, start a shorter debounce
		if (this.state.buffer.length > 0) {
			this.state.status = "debouncing"
			await this.ctx.storage.setAlarm(Date.now() + ACTIVE_DEBOUNCE_MS)
		}

		await this.persist()
	}
}
