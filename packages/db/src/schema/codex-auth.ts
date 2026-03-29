import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { computeVolumes } from "./compute"
import { users } from "./users"
import { vault } from "./vault"

export type CodexAuthMethod = "api_key" | "chatgpt"

export type CodexAuthStatus = "unauthenticated" | "pending" | "authenticated" | "invalid" | "revoked"

export const codexAuthStates = pgTable(
	"codex_auth_states",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		computeVolumeId: uuid("compute_volume_id").references(() => computeVolumes.id, {
			onDelete: "set null",
		}),
		activeVaultId: uuid("active_vault_id").references(() => vault.id, {
			onDelete: "set null",
		}),
		activeVaultVersion: integer("active_vault_version"),
		method: text("method").$type<CodexAuthMethod>().notNull(),
		status: text("status").$type<CodexAuthStatus>().notNull(),
		apiKeyLast4: text("api_key_last4"),
		accountId: text("account_id"),
		workspaceId: text("workspace_id"),
		planType: text("plan_type"),
		lastRefresh: timestamp("last_refresh", { withTimezone: true }),
		pendingDeviceAuth: jsonb("pending_device_auth"),
		lastError: text("last_error"),
		lastMaterializedVersion: integer("last_materialized_version"),
		lastMaterializedAt: timestamp("last_materialized_at", { withTimezone: true }),
		lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("codex_auth_states_user_idx").on(t.userId)],
)
