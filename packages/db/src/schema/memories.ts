import {
	boolean,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	vector,
} from "drizzle-orm/pg-core"
import { users } from "./users"

export const memories = pgTable("memories", {
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
	parentId: uuid("parent_id"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
})
