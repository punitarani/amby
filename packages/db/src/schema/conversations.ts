import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const conversations = pgTable(
	"conversations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		channelType: text("channel_type").notNull().default("cli"),
		title: text("title"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("conversations_user_updated_idx").on(t.userId, t.updatedAt)],
)

export const conversationThreads = pgTable(
	"conversation_threads",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		label: text("label"),
		synopsis: text("synopsis"),
		keywords: text("keywords").array(),
		status: text("status").$type<"open" | "archived">().notNull().default("open"),
		lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("threads_conversation_active_idx").on(t.conversationId, t.status, t.lastActiveAt)],
)

export const messages = pgTable(
	"messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		threadId: uuid("thread_id").references(() => conversationThreads.id, { onDelete: "set null" }),
		role: text("role").$type<"user" | "assistant" | "system" | "tool">().notNull(),
		content: text("content").notNull(),
		toolCalls: jsonb("tool_calls"),
		toolResults: jsonb("tool_results"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
		index("messages_thread_idx").on(t.threadId, t.createdAt),
	],
)

export const traces = pgTable(
	"traces",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		messageId: uuid("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		agentName: text("agent_name").notNull(),
		parentTraceId: uuid("parent_trace_id"),
		toolCalls:
			jsonb("tool_calls").$type<Array<{ toolCallId: string; toolName: string; input: unknown }>>(),
		toolResults:
			jsonb("tool_results").$type<
				Array<{ toolCallId: string; toolName: string; output: unknown }>
			>(),
		durationMs: integer("duration_ms"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("traces_message_id_idx").on(t.messageId),
		index("traces_parent_trace_id_idx").on(t.parentTraceId),
	],
)
