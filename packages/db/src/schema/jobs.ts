import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const jobs = pgTable("jobs", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	type: text("type").$type<"cron" | "scheduled" | "event">().notNull(),
	status: text("status")
		.$type<"active" | "pending" | "running" | "completed" | "failed">()
		.notNull()
		.default("active"),
	schedule: text("schedule"), // cron expression
	runAt: timestamp("run_at"), // for one-time jobs
	payload: jsonb("payload").$type<Record<string, unknown>>(),
	channelType: text("channel_type").$type<"cli" | "telegram">().notNull().default("cli"),
	lastRunAt: timestamp("last_run_at"),
	nextRunAt: timestamp("next_run_at"),
	error: text("error"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
})
