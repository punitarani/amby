import { Context, type Effect } from "effect"
import type { Conversation, Message, Thread } from "../domain/conversation"
import type { Platform } from "../domain/platform"
import type { CoreError } from "../errors/core-error"

export interface ConversationRepository {
	readonly upsert: (params: {
		userId: string
		platform: Platform
		externalConversationKey: string
	}) => Effect.Effect<string, CoreError>

	readonly findById: (id: string) => Effect.Effect<Conversation | undefined, CoreError>
}

export interface ThreadRepository {
	readonly findByConversation: (
		conversationId: string,
		status?: "open" | "archived",
	) => Effect.Effect<Thread[], CoreError>

	readonly findDefault: (conversationId: string) => Effect.Effect<Thread | undefined, CoreError>

	readonly create: (params: {
		conversationId: string
		source: Thread["source"]
		label?: string
		isDefault?: boolean
	}) => Effect.Effect<Thread, CoreError>

	readonly update: (
		id: string,
		fields: Partial<Pick<Thread, "label" | "synopsis" | "keywords" | "status" | "lastActiveAt">>,
	) => Effect.Effect<void, CoreError>

	readonly archive: (id: string) => Effect.Effect<void, CoreError>
}

export interface MessageRepository {
	readonly findByThread: (
		threadId: string,
		options?: { limit?: number; before?: Date },
	) => Effect.Effect<Message[], CoreError>

	readonly findByConversation: (
		conversationId: string,
		options?: { limit?: number; before?: Date },
	) => Effect.Effect<Message[], CoreError>

	readonly create: (params: {
		conversationId: string
		threadId?: string
		runId?: string
		role: Message["role"]
		contentText: string
		partsJson?: unknown
		metadata?: Record<string, unknown>
	}) => Effect.Effect<Message, CoreError>
}

export class ConversationRepo extends Context.Tag("ConversationRepo")<
	ConversationRepo,
	ConversationRepository
>() {}

export class ThreadRepo extends Context.Tag("ThreadRepo")<ThreadRepo, ThreadRepository>() {}

export class MessageRepo extends Context.Tag("MessageRepo")<MessageRepo, MessageRepository>() {}
