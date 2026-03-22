import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const userVolumes = pgTable("user_volumes", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id")
		.notNull()
		.unique()
		.references(() => users.id, { onDelete: "cascade" }),
	daytonaVolumeId: text("daytona_volume_id").notNull().unique(),
	status: text("status").$type<"creating" | "ready" | "error">().notNull().default("creating"),
	authConfig: jsonb("auth_config").$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
