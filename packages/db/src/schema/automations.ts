import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export type AutomationKind = "cron" | "scheduled" | "event"
export type AutomationStatus = "active" | "pending" | "running" | "completed" | "failed"

export const automations = pgTable(
	"automations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		kind: text("kind").$type<AutomationKind>().notNull(),
		status: text("status").$type<AutomationStatus>().notNull().default("active"),
		scheduleJson: jsonb("schedule_json").$type<Record<string, unknown>>(),
		nextRunAt: timestamp("next_run_at", { withTimezone: true }),
		lastRunAt: timestamp("last_run_at", { withTimezone: true }),
		payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
		deliveryTargetJson: jsonb("delivery_target_json").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("automations_user_idx").on(t.userId),
		index("automations_status_next_run_idx").on(t.status, t.nextRunAt),
	],
)
