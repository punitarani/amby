import { sql } from "drizzle-orm"
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const userVolumes = pgTable("user_volumes", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id")
		.notNull()
		.unique()
		.references(() => users.id, { onDelete: "cascade" }),
	daytonaVolumeId: text("daytona_volume_id").notNull().unique(),
	status: text("status")
		.$type<"creating" | "ready" | "error" | "deleted">()
		.notNull()
		.default("creating"),
	authConfig: jsonb("auth_config").$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const sandboxes = pgTable(
	"sandboxes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		daytonaSandboxId: text("daytona_sandbox_id"),
		volumeId: uuid("volume_id")
			.notNull()
			.references(() => userVolumes.id, { onDelete: "restrict" }),
		role: text("role").$type<"main" | "secondary">().notNull().default("main"),
		status: text("status")
			.$type<
				"volume_creating" | "creating" | "running" | "stopped" | "archived" | "error" | "deleted"
			>()
			.notNull()
			.default("volume_creating"),
		snapshot: text("snapshot"),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("sandboxes_user_main_idx")
			.on(t.userId, t.role)
			.where(sql`role = 'main' AND status != 'deleted'`),
	],
)
