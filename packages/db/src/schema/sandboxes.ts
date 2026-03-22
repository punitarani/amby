import { sql } from "drizzle-orm"
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { userVolumes } from "./user-volumes"
import { users } from "./users"

export const sandboxes = pgTable(
	"sandboxes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		daytonaSandboxId: text("daytona_sandbox_id").notNull(),
		volumeId: uuid("volume_id").references(() => userVolumes.id, { onDelete: "set null" }),
		role: text("role").$type<"main" | "secondary">().notNull().default("main"),
		status: text("status")
			.$type<"creating" | "running" | "stopped" | "archived" | "error">()
			.notNull()
			.default("creating"),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("sandboxes_user_main_idx").on(t.userId, t.role).where(sql`role = 'main'`)],
)
