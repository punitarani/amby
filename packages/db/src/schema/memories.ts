import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	vector,
} from "drizzle-orm/pg-core"
import { users } from "./users"

export const memories = pgTable(
	"memories",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		content: text("content").notNull(),
		category: text("category")
			.$type<"static" | "dynamic" | "inference">()
			.notNull()
			.default("dynamic"),
		isActive: boolean("is_active").notNull().default(true),
		source: text("source"), // where this memory came from (conversation id, manual, etc.)
		embedding: vector("embedding", { dimensions: 1536 }),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		version: integer("version").notNull().default(1),
		parentId: uuid("parent_id").references((): AnyPgColumn => memories.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("memories_user_active_idx").on(t.userId, t.isActive)],
)
