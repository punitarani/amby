import { sql } from "drizzle-orm"
import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { users } from "./users"

// --- Types ---

export type Platform = "cli" | "telegram" | "slack" | "discord"
export type ThreadSource = "native" | "reply_chain" | "derived" | "manual"

// SpecialistKind, RunnerKind, ExecutionMode have moved to ./runs.ts
// They are still accessible via the schema barrel export (schema/index.ts).

// --- Table 1: conversations — platform containers ---

export const conversations = pgTable(
	"conversations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		platform: text("platform").$type<Platform>().notNull(),
		workspaceKey: text("workspace_key").notNull().default(""),
		externalConversationKey: text("external_conversation_key").notNull(),
		title: text("title"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("conversations_platform_key_idx").on(
			t.userId,
			t.platform,
			t.workspaceKey,
			t.externalConversationKey,
		),
		index("conversations_user_idx").on(t.userId),
	],
)

// --- Table 2: conversation_threads — internal routing layer ---

export const conversationThreads = pgTable(
	"conversation_threads",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		source: text("source").$type<ThreadSource>().notNull(),
		externalThreadKey: text("external_thread_key"),
		label: text("label"),
		synopsis: text("synopsis"),
		keywords: text("keywords").array(),
		isDefault: boolean("is_default").notNull().default(false),
		status: text("status").$type<"open" | "archived">().notNull().default("open"),
		lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("threads_conversation_active_idx").on(t.conversationId, t.status, t.lastActiveAt),
		uniqueIndex("threads_default_unique_idx").on(t.conversationId).where(sql`is_default = true`),
		uniqueIndex("threads_external_key_idx")
			.on(t.conversationId, t.externalThreadKey)
			.where(sql`external_thread_key IS NOT NULL`),
	],
)

// --- Table 3: messages — user-visible only, NO execution data ---

export const messages = pgTable(
	"messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		threadId: uuid("thread_id").references(() => conversationThreads.id, { onDelete: "set null" }),
		role: text("role").$type<"user" | "assistant">().notNull(),
		content: text("content").notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
		index("messages_thread_idx").on(t.threadId, t.createdAt),
	],
)

// --- traces and trace_events tables removed ---
// Execution tracking is now unified in the runs/run_events tables (see ./runs.ts).
