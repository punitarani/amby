import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const conversations = pgTable(
	"conversations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		channelType: text("channel_type").notNull().default("cli"),
		title: text("title"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("conversations_user_updated_idx").on(t.userId, t.updatedAt)],
)
