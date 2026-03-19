import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const sandboxes = pgTable("sandboxes", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id")
		.notNull()
		.unique()
		.references(() => users.id, { onDelete: "cascade" }),
	daytonaSandboxId: text("daytona_sandbox_id").notNull(),
	daytonaVolumeId: text("daytona_volume_id"),
	status: text("status")
		.$type<"creating" | "running" | "stopped" | "archived" | "error">()
		.notNull()
		.default("creating"),
	authConfig: jsonb("auth_config").$type<Record<string, unknown>>(),
	lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
