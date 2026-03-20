import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { conversations } from "./conversations"

export const conversationThreads = pgTable(
	"conversation_threads",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		label: text("label"),
		synopsis: text("synopsis"),
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
