import { sql } from "drizzle-orm"
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { users } from "./users"

// --- Types ---

export type Platform = "telegram"
export type ThreadSource = "native" | "reply_chain" | "derived" | "manual"
export type SpecialistKind =
	| "conversation"
	| "planner"
	| "research"
	| "builder"
	| "integration"
	| "computer"
	| "browser"
	| "memory"
	| "settings"
	| "validator"
export type RunnerKind = "toolloop" | "browser_service" | "background_handoff"
export type ExecutionMode = "direct" | "sequential" | "parallel" | "background"
export type TraceEventKind =
	| "context_built"
	| "model_request"
	| "model_response"
	| "tool_call"
	| "tool_result"
	| "delegation_start"
	| "delegation_end"
	| "error"

// --- Table 1: conversations — platform containers ---

export const conversations = pgTable(
	"conversations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		platform: text("platform").$type<Platform>().notNull(),
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

// --- Table 4: traces — OTel-style execution spans ---

export const traces = pgTable(
	"traces",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		threadId: uuid("thread_id").references(() => conversationThreads.id, {
			onDelete: "set null",
		}),
		messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
		parentTraceId: uuid("parent_trace_id"),
		rootTraceId: uuid("root_trace_id"),
		taskId: uuid("task_id"),
		specialist: text("specialist").$type<SpecialistKind>(),
		runnerKind: text("runner_kind").$type<RunnerKind>(),
		mode: text("mode").$type<ExecutionMode>(),
		depth: integer("depth"),
		status: text("status").$type<"running" | "completed" | "failed">().notNull().default("running"),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		durationMs: integer("duration_ms"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	},
	(t) => [
		index("traces_conversation_idx").on(t.conversationId),
		index("traces_message_id_idx").on(t.messageId),
		index("traces_parent_trace_id_idx").on(t.parentTraceId),
		index("traces_root_trace_id_idx").on(t.rootTraceId),
		index("traces_task_id_idx").on(t.taskId),
		index("traces_specialist_idx").on(t.specialist),
		index("traces_runner_kind_idx").on(t.runnerKind),
		index("traces_mode_idx").on(t.mode),
		index("traces_thread_idx").on(t.threadId),
	],
)

// --- Table 5: trace_events — append-only execution log ---

export const traceEvents = pgTable(
	"trace_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		traceId: uuid("trace_id")
			.notNull()
			.references(() => traces.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		kind: text("kind").$type<TraceEventKind>().notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("trace_events_trace_seq_idx").on(t.traceId, t.seq)],
)
