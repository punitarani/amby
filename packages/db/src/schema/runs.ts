import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { conversations, conversationThreads, messages } from "./conversations"

export type RunStatus = "running" | "completed" | "failed"
export type RunEventKind =
	| "context_built"
	| "router_decision"
	| "skill_activated"
	| "planner_output"
	| "tool_call"
	| "tool_result"
	| "task_spawned"
	| "task_observed"
	| "model_request"
	| "model_response"
	| "error"
	| "completed"

export const runs = pgTable(
	"runs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		threadId: uuid("thread_id")
			.notNull()
			.references(() => conversationThreads.id, { onDelete: "cascade" }),
		triggerMessageId: uuid("trigger_message_id").references(() => messages.id, {
			onDelete: "set null",
		}),
		status: text("status").$type<RunStatus>().notNull().default("running"),
		mode: text("mode")
			.$type<"direct" | "sequential" | "parallel" | "background">()
			.notNull()
			.default("direct"),
		modelId: text("model_id").notNull(),
		summary: text("summary"),
		requestJson: jsonb("request_json").$type<Record<string, unknown>>(),
		responseJson: jsonb("response_json").$type<Record<string, unknown>>(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(t) => [
		index("runs_conversation_idx").on(t.conversationId),
		index("runs_thread_idx").on(t.threadId),
		index("runs_status_idx").on(t.status),
		index("runs_started_at_idx").on(t.startedAt),
	],
)

export const runEvents = pgTable(
	"run_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		runId: uuid("run_id")
			.notNull()
			.references(() => runs.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		kind: text("kind").$type<RunEventKind>().notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("run_events_run_seq_idx").on(t.runId, t.seq),
		index("run_events_kind_idx").on(t.kind),
	],
)
