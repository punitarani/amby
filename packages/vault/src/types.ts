import type { DbError } from "@amby/core"
import { Context, type Effect } from "effect"

// ---------------------------------------------------------------------------
// Domain value types
// ---------------------------------------------------------------------------

export type VaultNamespace = "codex" | (string & {})
export type VaultKind = "codex_api_key" | "codex_chatgpt_home" | (string & {})
export type VaultStatus = "active" | "revoked" | "deleted"
export type VaultAccessAction =
	| "create"
	| "read"
	| "resolve"
	| "inject"
	| "rotate"
	| "revoke"
	| "delete"
export type VaultActorType = "user" | "agent" | "tool" | "system"

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface VaultItem {
	id: string
	userId: string
	namespace: VaultNamespace
	itemKey: string
	displayName?: string | null
	kind: VaultKind
	metadataJson?: Record<string, unknown> | null
	policyJson?: Record<string, unknown> | null
	currentVersion: number
	status: VaultStatus
	createdAt: Date
	updatedAt: Date
}

export interface VaultVersion {
	id: string
	vaultId: string
	version: number
	cryptoAlg: string
	kekVersion: number
	dekWrapped: string // base64
	nonce: string // base64
	ciphertext: string // base64 (includes GCM auth tag)
	createdByType: VaultActorType
	createdById?: string | null
	createdAt: Date
}

export interface VaultAccessLogEntry {
	vaultId: string
	vaultVersionId?: string | null
	action: VaultAccessAction
	actorType: VaultActorType
	actorId?: string | null
	purpose?: string | null
	runId?: string | null
	taskId?: string | null
}

// ---------------------------------------------------------------------------
// Port: VaultStore — persistence boundary for vault items and versions
// ---------------------------------------------------------------------------

export interface VaultStoreService {
	readonly insertItem: (values: {
		id: string
		userId: string
		namespace: VaultNamespace
		itemKey: string
		kind: VaultKind
		displayName?: string | null
		metadataJson?: Record<string, unknown> | null
		policyJson?: Record<string, unknown> | null
		currentVersion: number
		status: VaultStatus
	}) => Effect.Effect<VaultItem, DbError>

	readonly updateItem: (
		id: string,
		set: Partial<
			Pick<VaultItem, "displayName" | "kind" | "currentVersion" | "status" | "metadataJson">
		>,
	) => Effect.Effect<void, DbError>

	readonly getItemById: (id: string) => Effect.Effect<VaultItem | null, DbError>

	readonly getItemByKey: (
		userId: string,
		namespace: string,
		itemKey: string,
	) => Effect.Effect<VaultItem | null, DbError>

	readonly insertVersion: (values: {
		id: string
		vaultId: string
		version: number
		cryptoAlg: string
		kekVersion: number
		dekWrapped: string
		nonce: string
		ciphertext: string
		createdByType: VaultActorType
		createdById?: string | null
	}) => Effect.Effect<VaultVersion, DbError>

	readonly getVersion: (
		vaultId: string,
		version: number,
	) => Effect.Effect<VaultVersion | null, DbError>

	readonly getLatestVersion: (vaultId: string) => Effect.Effect<VaultVersion | null, DbError>

	readonly insertAccessLog: (values: VaultAccessLogEntry) => Effect.Effect<void, DbError>
}

export class VaultStore extends Context.Tag("VaultStore")<VaultStore, VaultStoreService>() {}

// ---------------------------------------------------------------------------
// Port: CodexAuthStore — persistence boundary for codex auth state
// ---------------------------------------------------------------------------

export interface CodexAuthStateRow {
	id: string
	userId: string
	activeVaultId: string | null
	activeVaultVersion: number | null
	method: "api_key" | "chatgpt"
	status: "unauthenticated" | "pending" | "authenticated" | "invalid" | "revoked"
	apiKeyLast4: string | null
	accountId: string | null
	workspaceId: string | null
	planType: string | null
	lastRefresh: Date | null
	pendingDeviceAuth: Record<string, unknown> | null
	lastError: string | null
	lastMaterializedVersion: number | null
	lastMaterializedAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export class CodexAuthStore extends Context.Tag("CodexAuthStore")<
	CodexAuthStore,
	{
		readonly getByUserId: (userId: string) => Effect.Effect<CodexAuthStateRow | null, DbError>
		readonly upsert: (
			userId: string,
			values: Partial<
				Omit<CodexAuthStateRow, "id" | "userId" | "createdAt" | "updatedAt">
			>,
		) => Effect.Effect<CodexAuthStateRow, DbError>
	}
>() {}
