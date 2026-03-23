import {
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core"
import {
	conversations,
	conversationThreads,
	type RunnerKind,
	type SpecialistKind,
} from "./conversations"
import { users } from "./users"

export type TaskStatus =
	| "pending"
	| "awaiting_auth"
	| "preparing"
	| "running"
	| "succeeded"
	| "partial"
	| "escalated"
	| "failed"
	| "cancelled"
	| "timed_out"
	| "lost"

export type TaskRuntime = "in_process" | "browser" | "sandbox"
export type TaskProvider = "internal" | "stagehand" | "codex"
export type SandboxTaskRuntimeData = {
	authMode?: "api_key" | "chatgpt_account"
	sandboxId?: string
	sessionId?: string
	commandId?: string
	artifactRoot?: string
}

export const tasks = pgTable(
	"tasks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		runtime: text("runtime").$type<TaskRuntime>().notNull(),
		provider: text("provider").$type<TaskProvider>().notNull(),
		status: text("status").$type<TaskStatus>().notNull().default("pending"),
		threadId: uuid("thread_id").references(() => conversationThreads.id, { onDelete: "set null" }),
		traceId: uuid("trace_id"),
		parentTaskId: uuid("parent_task_id"),
		rootTaskId: uuid("root_task_id"),
		specialist: text("specialist").$type<SpecialistKind>(),
		runnerKind: text("runner_kind").$type<RunnerKind>(),
		input: jsonb("input").$type<unknown>(),
		output: jsonb("output").$type<unknown>(),
		artifacts: jsonb("artifacts").$type<unknown>(),
		confirmationState: text("confirmation_state").$type<
			"not_required" | "required" | "confirmed" | "rejected"
		>(),
		prompt: text("prompt").notNull(),
		requiresBrowser: boolean("requires_browser").notNull().default(false),
		runtimeData: jsonb("runtime_data").$type<Record<string, unknown>>(),
		outputSummary: text("output_summary"),
		error: text("error"),
		exitCode: integer("exit_code"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		conversationId: uuid("conversation_id").references(() => conversations.id, {
			onDelete: "set null",
		}),
		replyTarget: jsonb("reply_target").$type<Record<string, unknown>>(),
		callbackId: uuid("callback_id"),
		callbackSecretHash: text("callback_secret_hash"),
		lastEventSeq: integer("last_event_seq").notNull().default(0),
		lastEventAt: timestamp("last_event_at", { withTimezone: true }),
		lastProbeAt: timestamp("last_probe_at", { withTimezone: true }),
		/** Terminal status value last successfully notified (dedup + crash safety). */
		notifiedStatus: text("notified_status"),
		lastNotificationAt: timestamp("last_notification_at", { withTimezone: true }),
	},
	(t) => [
		index("tasks_user_status_idx").on(t.userId, t.status),
		index("tasks_thread_idx").on(t.threadId),
		index("tasks_trace_id_idx").on(t.traceId),
		index("tasks_parent_task_id_idx").on(t.parentTaskId),
		index("tasks_root_task_id_idx").on(t.rootTaskId),
		index("tasks_specialist_idx").on(t.specialist),
		index("tasks_runner_kind_idx").on(t.runnerKind),
		index("tasks_callback_id_idx").on(t.callbackId),
		index("tasks_status_heartbeat_idx").on(t.status, t.heartbeatAt),
		index("tasks_runtime_status_heartbeat_idx").on(t.runtime, t.status, t.heartbeatAt),
		foreignKey({
			columns: [t.parentTaskId],
			foreignColumns: [t.id],
			name: "tasks_parent_task_id_fkey",
		}),
		foreignKey({
			columns: [t.rootTaskId],
			foreignColumns: [t.id],
			name: "tasks_root_task_id_fkey",
		}),
	],
)
