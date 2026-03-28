import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "./users"

export const telegramIdentityBlocks = pgTable(
	"telegram_identity_blocks",
	{
		telegramUserId: text("telegram_user_id").primaryKey(),
		lastUserId: text("last_user_id").references(() => users.id, { onDelete: "set null" }),
		reason: text("reason").notNull().default("unlink"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index("telegram_identity_blocks_last_user_idx").on(table.lastUserId)],
)
