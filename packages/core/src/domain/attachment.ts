export type AttachmentDirection = "inbound" | "outbound"
export type AttachmentSource = "telegram" | "task_artifact" | "assistant"
export type AttachmentStatus = "pending" | "downloading" | "ready" | "failed" | "deleted"
export type AttachmentKind = "image" | "pdf" | "text" | "document" | "binary"

export interface AttachmentRef {
	readonly id: string
	readonly kind: AttachmentKind
	readonly mediaType: string
	readonly filename?: string | null
	readonly sizeBytes?: number | null
	readonly title?: string | null
	readonly status?: AttachmentStatus | null
	readonly metadata?: Record<string, unknown>
}

export interface TextMessagePart {
	readonly type: "text"
	readonly text: string
}

export interface AttachmentMessagePart {
	readonly type: "attachment"
	readonly attachment: AttachmentRef
}

export type ConversationMessagePart = TextMessagePart | AttachmentMessagePart

export interface TelegramAttachmentSourceRef {
	readonly kind: "telegram"
	readonly telegramType: "photo" | "document"
	readonly fileId: string
	readonly fileUniqueId?: string | null
	readonly chatId: number
	readonly sourceMessageId: number
	readonly mediaGroupId?: string | null
	readonly mediaType?: string | null
	readonly filename?: string | null
	readonly sizeBytes?: number | null
}

export interface BufferedAttachmentPart {
	readonly type: "attachment"
	readonly attachment: {
		readonly kind: AttachmentKind
		readonly mediaType?: string | null
		readonly filename?: string | null
		readonly sizeBytes?: number | null
		readonly title?: string | null
		readonly metadata?: Record<string, unknown>
		readonly source: TelegramAttachmentSourceRef
	}
}

export type BufferedMessagePart = TextMessagePart | BufferedAttachmentPart

export interface BufferedInboundMessage {
	readonly sourceMessageId: number
	readonly date: number
	readonly textSummary: string
	readonly parts: BufferedMessagePart[]
	readonly mediaGroupId?: string | null
	readonly from?: Record<string, unknown> | null
	readonly rawSource?: Record<string, unknown> | null
}

export interface StructuredUserMessage {
	readonly contentText: string
	readonly parts: ConversationMessagePart[]
}
