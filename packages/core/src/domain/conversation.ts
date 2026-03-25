import type { Platform } from "./platform"

export type ThreadSource = "native" | "reply_chain" | "derived" | "manual"
export type ThreadStatus = "open" | "archived"
export type MessageRole = "user" | "assistant"

export interface Conversation {
	readonly id: string
	readonly userId: string
	readonly platform: Platform
	readonly externalConversationKey: string
	readonly title?: string
	readonly metadata?: Record<string, unknown>
	readonly createdAt: Date
	readonly updatedAt: Date
}

export interface Thread {
	readonly id: string
	readonly conversationId: string
	readonly source: ThreadSource
	readonly externalThreadKey?: string
	readonly label?: string
	readonly synopsis?: string
	readonly keywords?: string[]
	readonly isDefault: boolean
	readonly status: ThreadStatus
	readonly lastActiveAt: Date
	readonly createdAt: Date
}

export interface Message {
	readonly id: string
	readonly conversationId: string
	readonly threadId?: string
	readonly runId?: string
	readonly role: MessageRole
	readonly contentText: string
	readonly partsJson?: unknown
	readonly metadata?: Record<string, unknown>
	readonly createdAt: Date
}
