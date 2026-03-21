import { sql } from "drizzle-orm"
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export type TaskStatus =
	| "pending"
	| "awaiting_auth"
	| "preparing"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "timed_out"
	| "lost"

export const tasks = pgTable(
	"tasks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		provider: text("provider").$type<"codex" | "claude_code">().notNull().default("codex"),
		authMode: text("auth_mode").$type<"api_key" | "chatgpt_account">().notNull().default("api_key"),
		status: text("status").$type<TaskStatus>().notNull().default("pending"),
		prompt: text("prompt").notNull(),
		// Stored as text "true"/"false" because Drizzle's boolean doesn't support
		// the .$type<>() branded-text pattern used for other enum-like columns,
		// and D1/Hyperdrive compatibility requires consistent column types.
		needsBrowser: text("needs_browser").$type<"true" | "false">().notNull().default("false"),
		sandboxId: text("sandbox_id"),
		sessionId: text("session_id"),
		commandId: text("command_id"),
		artifactRoot: text("artifact_root"),
		outputSummary: text("output_summary"),
		error: text("error"),
		exitCode: integer("exit_code"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		callbackTokenHash: text("callback_token_hash"),
		callbackTokenExpiresAt: timestamp("callback_token_expires_at", { withTimezone: true }),
		lastEventSeq: integer("last_event_seq").notNull().default(0),
		lastProbeAt: timestamp("last_probe_at", { withTimezone: true }),
	},
	(t) => [
		/** Per-user task lists + cap checks (e.g. active tasks for a user) */
		index("tasks_user_status_idx").on(t.userId, t.status),
		/**
		 * Reconciliation cron: `WHERE status IN ('preparing','running')`.
		 * Partial index keeps the working set small vs scanning all terminal tasks.
		 */
		index("tasks_active_runtime_idx")
			.on(t.userId)
			.where(sql`${t.status} IN ('preparing', 'running')`),
		/**
		 * Supervisor recovery: `status = 'preparing' AND created_at <= cutoff`.
		 */
		index("tasks_preparing_timeout_idx").on(t.createdAt).where(sql`${t.status} = 'preparing'`),
	],
)
