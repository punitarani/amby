import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { tasks } from "./tasks"

export type TaskEventType =
	| "task.started"
	| "task.heartbeat"
	| "task.progress"
	| "task.completed"
	| "task.failed"

export const taskEvents = pgTable(
	"task_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		eventType: text("event_type").$type<TaskEventType>().notNull(),
		status: text("status"),
		message: text("message"),
		exitCode: integer("exit_code"),
		payload: jsonb("payload").$type<Record<string, unknown>>(),
		receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		/** Idempotent append + conflict target; left-prefix covers lookups by `task_id` alone */
		uniqueIndex("task_events_task_seq_idx").on(t.taskId, t.seq),
	],
)
