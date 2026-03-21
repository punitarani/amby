import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const connectorAuthRequests = pgTable(
	"connector_auth_requests",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		toolkit: text("toolkit").notNull(),
		redirectUrl: text("redirect_url").notNull(),
		callbackUrl: text("callback_url").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("connector_auth_requests_user_toolkit_idx").on(table.userId, table.toolkit),
		index("connector_auth_requests_expires_at_idx").on(table.expiresAt),
	],
)
