import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export type VaultItemStatus = "active" | "revoked" | "deleted"

export type VaultVersionCreatedByType = "user" | "agent" | "tool" | "system"

export const vault = pgTable(
	"vault",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		namespace: text("namespace").notNull(),
		itemKey: text("item_key").notNull(),
		displayName: text("display_name"),
		kind: text("kind").notNull(),
		metadataJson: jsonb("metadata_json"),
		policyJson: jsonb("policy_json"),
		currentVersion: integer("current_version").notNull().default(0),
		status: text("status").$type<VaultItemStatus>().notNull().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("vault_user_ns_key_idx").on(t.userId, t.namespace, t.itemKey),
		index("vault_user_status_idx").on(t.userId, t.status),
	],
)

export const vaultVersions = pgTable(
	"vault_versions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		vaultId: uuid("vault_id")
			.notNull()
			.references(() => vault.id, { onDelete: "cascade" }),
		version: integer("version").notNull(),
		cryptoAlg: text("crypto_alg").notNull().default("aes-256-gcm"),
		kekVersion: integer("kek_version").notNull(),
		dekWrapped: text("dek_wrapped").notNull(),
		nonce: text("nonce").notNull(),
		ciphertext: text("ciphertext").notNull(),
		createdByType: text("created_by_type")
			.$type<VaultVersionCreatedByType>()
			.notNull()
			.default("system"),
		createdById: text("created_by_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("vault_versions_vault_version_idx").on(t.vaultId, t.version),
		index("vault_versions_vault_idx").on(t.vaultId),
	],
)

export const vaultAccessLog = pgTable(
	"vault_access_log",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		vaultId: uuid("vault_id")
			.notNull()
			.references(() => vault.id, { onDelete: "cascade" }),
		vaultVersionId: uuid("vault_version_id"),
		action: text("action").notNull(),
		actorType: text("actor_type").notNull(),
		actorId: text("actor_id"),
		purpose: text("purpose"),
		runId: uuid("run_id"),
		taskId: uuid("task_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("vault_access_log_vault_idx").on(t.vaultId),
		index("vault_access_log_actor_idx").on(t.actorType, t.actorId),
	],
)
