import { Context, type Effect } from "effect"
import type { DbError } from "../errors/core-error"

export type CodexAuthMethod = "api_key" | "chatgpt"

export type CodexAuthStatus =
	| "unauthenticated"
	| "pending"
	| "authenticated"
	| "invalid"
	| "revoked"

export interface CodexAuthStateRow {
	id: string
	userId: string
	computeVolumeId: string | null
	activeVaultId: string | null
	activeVaultVersion: number | null
	method: CodexAuthMethod
	status: CodexAuthStatus
	apiKeyLast4: string | null
	accountId: string | null
	workspaceId: string | null
	planType: string | null
	lastRefresh: Date | null
	pendingDeviceAuth: unknown
	lastError: string | null
	lastMaterializedVersion: number | null
	lastMaterializedAt: Date | null
	lastValidatedAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface CodexAuthStoreService {
	readonly getByUserId: (userId: string) => Effect.Effect<CodexAuthStateRow | null, DbError>
	readonly upsert: (
		userId: string,
		values: {
			method: CodexAuthMethod
			status: CodexAuthStatus
			activeVaultId?: string | null
			activeVaultVersion?: number | null
			computeVolumeId?: string | null
			apiKeyLast4?: string | null
			accountId?: string | null
			workspaceId?: string | null
			planType?: string | null
			lastRefresh?: Date | null
			pendingDeviceAuth?: unknown
			lastError?: string | null
			lastMaterializedVersion?: number | null
			lastMaterializedAt?: Date | null
			lastValidatedAt?: Date | null
		},
	) => Effect.Effect<CodexAuthStateRow, DbError>
}

export class CodexAuthStore extends Context.Tag("CodexAuthStore")<
	CodexAuthStore,
	CodexAuthStoreService
>() {}
