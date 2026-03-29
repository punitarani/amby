import { TELEGRAM_RELINK_REQUIRED_MESSAGE } from "@amby/auth"
import { splitTelegramMessage } from "@amby/channels"
import type { ClaimFirstOutboundResult } from "../durable-objects/conversation-session-state"

export interface TelegramDeliveryAdapter {
	deleteMessage(chatId: string, messageId: string): Promise<unknown>
	editMessage(chatId: string, messageId: string, text: string): Promise<unknown>
	postMessage(chatId: string, text: string): Promise<{ id: string }>
	startTyping(chatId: string): Promise<unknown>
}

export const AGENT_LOOP_STEP_OPTIONS = {
	timeout: "5 minutes",
} as const

export function createTelegramDeliveryController(params: {
	adapter: TelegramDeliveryAdapter
	chatId: string
	claimFirstOutbound: () => Promise<ClaimFirstOutboundResult>
}) {
	const state = {
		firstOutboundClaimed: false,
		visibleOutputSent: false,
		suppressed: false,
	}

	const markVisibleOutputSent = () => {
		state.firstOutboundClaimed = true
		state.visibleOutputSent = true
	}

	const ensureFirstOutboundClaimed = async () => {
		if (state.firstOutboundClaimed) return true
		const result = await params.claimFirstOutbound()
		if (result.allowed) {
			state.firstOutboundClaimed = true
			return true
		}
		state.suppressed = result.reason === "stale" || result.reason === "superseded"
		return false
	}

	return {
		getState: () => ({
			firstOutboundClaimed: state.firstOutboundClaimed,
			visibleOutputSent: state.visibleOutputSent,
			suppressed: state.suppressed,
		}),

		startTyping: async () => {
			await params.adapter.startTyping(params.chatId).catch(() => {})
		},

		sendRelinkRequired: async () => {
			if (!(await ensureFirstOutboundClaimed())) return false
			try {
				await params.adapter.postMessage(params.chatId, TELEGRAM_RELINK_REQUIRED_MESSAGE)
				markVisibleOutputSent()
				return true
			} catch {
				return false
			}
		},

		sendProgress: async (text: string) => {
			if (!(await ensureFirstOutboundClaimed())) return false
			try {
				await params.adapter.postMessage(params.chatId, text)
				markVisibleOutputSent()
				return true
			} catch {
				return false
			}
		},

		flushStreamText: async (text: string, streamMessageId: string | null) => {
			if (!text || state.suppressed) return streamMessageId

			if (!streamMessageId) {
				if (!(await ensureFirstOutboundClaimed())) return null
				try {
					const posted = await params.adapter.postMessage(params.chatId, text)
					markVisibleOutputSent()
					return posted.id
				} catch {
					return null
				}
			}

			await params.adapter.editMessage(params.chatId, streamMessageId, text).catch(() => {})
			return streamMessageId
		},

		finalizeResponse: async (finalText: string, streamMessageId: string | null) => {
			if (state.suppressed) return

			if (streamMessageId) {
				if (finalText.trim()) {
					const [firstChunk, ...moreChunks] = splitTelegramMessage(finalText)
					if (firstChunk !== undefined) {
						await params.adapter
							.editMessage(params.chatId, streamMessageId, firstChunk)
							.catch(() => {})
						for (const chunk of moreChunks) {
							await params.adapter
								.postMessage(params.chatId, chunk)
								.then(() => {
									markVisibleOutputSent()
								})
								.catch(() => {})
						}
					}
				} else {
					await params.adapter.deleteMessage(params.chatId, streamMessageId).catch(() => {})
				}
				return
			}

			if (!finalText.trim()) return
			if (!(await ensureFirstOutboundClaimed())) return

			for (const chunk of splitTelegramMessage(finalText)) {
				await params.adapter
					.postMessage(params.chatId, chunk)
					.then(() => {
						markVisibleOutputSent()
					})
					.catch(() => {})
			}
		},

		sendErrorReply: async (text: string) => {
			if (state.visibleOutputSent || state.suppressed) return false
			if (!(await ensureFirstOutboundClaimed())) return false
			try {
				await params.adapter.postMessage(params.chatId, text)
				markVisibleOutputSent()
				return true
			} catch {
				return false
			}
		},
	}
}
