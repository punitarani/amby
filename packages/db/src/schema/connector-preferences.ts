import { index, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"

export const connectorPreferences = pgTable(
	"connector_preferences",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		toolkit: text("toolkit").notNull(),
		preferredConnectedAccountId: text("preferred_connected_account_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("connector_preferences_user_toolkit_idx").on(table.userId, table.toolkit),
		index("connector_preferences_connected_account_idx").on(table.preferredConnectedAccountId),
	],
)
