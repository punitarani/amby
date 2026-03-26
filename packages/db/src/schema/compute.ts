import { sql } from "drizzle-orm"
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export type ComputeVolumeStatus = "creating" | "ready" | "error" | "deleted"
export type ComputeInstanceStatus =
	| "volume_creating"
	| "creating"
	| "running"
	| "stopped"
	| "archived"
	| "error"
	| "deleted"

export type ComputeInstanceRole = "main" | "secondary"

export const computeVolumes = pgTable("compute_volumes", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id")
		.notNull()
		.unique()
		.references(() => users.id, { onDelete: "cascade" }),
	externalVolumeId: text("external_volume_id").notNull().unique(),
	status: text("status").$type<ComputeVolumeStatus>().notNull().default("creating"),
	authConfig: jsonb("auth_config").$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const computeInstances = pgTable(
	"compute_instances",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		volumeId: uuid("volume_id")
			.notNull()
			.references(() => computeVolumes.id, { onDelete: "restrict" }),
		externalInstanceId: text("external_instance_id"),
		role: text("role").$type<ComputeInstanceRole>().notNull().default("main"),
		status: text("status").$type<ComputeInstanceStatus>().notNull().default("volume_creating"),
		snapshot: text("snapshot"),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("compute_instances_user_main_idx")
			.on(t.userId, t.role)
			.where(sql`role = 'main' AND status != 'deleted'`),
	],
)
