import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { tasks } from "./tasks"

export type TaskEventSource = "server" | "harness" | "codex_notify" | "reconciler"
export type TaskEventKind =
	| "task.created"
	| "task.started"
	| "task.progress"
	| "task.heartbeat"
	| "task.completed"
	| "task.failed"
	| "task.timed_out"
	| "task.lost"
	| "task.notification_sent"
	| "codex.notify"
	| "reconciler.probe"

export const taskEvents = pgTable(
	"task_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		eventId: uuid("event_id").notNull(),
		source: text("source").$type<TaskEventSource>().notNull(),
		kind: text("kind").$type<TaskEventKind>().notNull(),
		/**
		 * Monotonic sequence for `source = 'harness'` events only; all non-harness events use
		 * `null` so the durable log stays append-only and non-authoritative for external sources.
		 * This includes `task.created`, `codex.notify`, and reconciler metadata events.
		 */
		seq: integer("seq"),
		payload: jsonb("payload").$type<Record<string, unknown>>(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("task_events_task_event_id_idx").on(t.taskId, t.eventId),
		index("task_events_task_id_idx").on(t.taskId),
		index("task_events_task_seq_idx").on(t.taskId, t.seq),
		index("task_events_task_occurred_idx").on(t.taskId, t.occurredAt),
	],
)
