import type {
	AttachmentDirection,
	AttachmentKind,
	AttachmentSource,
	AttachmentStatus,
} from "@amby/core"
import { sql } from "drizzle-orm"
import {
	bigint,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { conversations, conversationThreads, messages } from "./conversations"
import { tasks } from "./tasks"
import { users } from "./users"

export const attachments = pgTable(
	"attachments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		conversationId: uuid("conversation_id").references(() => conversations.id, {
			onDelete: "set null",
		}),
		threadId: uuid("thread_id").references(() => conversationThreads.id, { onDelete: "set null" }),
		messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
		taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
		direction: text("direction").$type<AttachmentDirection>().notNull(),
		source: text("source").$type<AttachmentSource>().notNull(),
		kind: text("kind").$type<AttachmentKind>().notNull(),
		status: text("status").$type<AttachmentStatus>().notNull(),
		dedupeKey: text("dedupe_key"),
		mediaType: text("media_type").notNull(),
		originalFilename: text("original_filename"),
		title: text("title"),
		sizeBytes: bigint("size_bytes", { mode: "number" }),
		sha256: text("sha256"),
		r2Key: text("r2_key"),
		sourceRef: jsonb("source_ref").$type<Record<string, unknown>>(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("attachments_user_status_idx").on(t.userId, t.status),
		index("attachments_message_idx").on(t.messageId),
		index("attachments_task_idx").on(t.taskId),
		index("attachments_conversation_idx").on(t.conversationId, t.createdAt),
		uniqueIndex("attachments_dedupe_key_unique_idx")
			.on(t.dedupeKey)
			.where(sql`${t.dedupeKey} IS NOT NULL`),
	],
)
