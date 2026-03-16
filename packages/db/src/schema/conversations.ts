import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const conversations = pgTable("conversations", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	channelType: text("channel_type").notNull().default("cli"),
	title: text("title"),
	metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const messages = pgTable("messages", {
	id: uuid("id").primaryKey().defaultRandom(),
	conversationId: uuid("conversation_id")
		.notNull()
		.references(() => conversations.id, { onDelete: "cascade" }),
	role: text("role").$type<"user" | "assistant" | "system" | "tool">().notNull(),
	content: text("content").notNull(),
	toolCalls: jsonb("tool_calls"),
	toolResults: jsonb("tool_results"),
	metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
})
