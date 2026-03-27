import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { users } from "./users"

export type IntegrationProvider = "gmail" | "googlecalendar" | "notion" | "slack" | "googledrive"

export type IntegrationAccountStatus = "active" | "pending" | "expired" | "revoked"

/** Metadata stored on pending auth-request rows (status='pending', no externalAccountId). */
export type PendingAuthMetadata = {
	redirectUrl: string
	callbackUrl: string
	expiresAt: string
}

export const integrationAccounts = pgTable(
	"integration_accounts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		provider: text("provider").$type<IntegrationProvider>().notNull(),
		externalAccountId: text("external_account_id"),
		status: text("status").$type<IntegrationAccountStatus>().notNull().default("pending"),
		isPreferred: boolean("is_preferred").notNull().default(false),
		metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("integration_accounts_user_idx").on(t.userId),
		index("integration_accounts_provider_idx").on(t.userId, t.provider),
		uniqueIndex("integration_accounts_external_idx").on(t.userId, t.provider, t.externalAccountId),
	],
)
