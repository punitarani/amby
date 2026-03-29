import { CodexAuthStore as CoreCodexAuthStore, VaultStore as CoreVaultStore } from "@amby/core"

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
// Re-export canonical Context tags from @amby/core
// ---------------------------------------------------------------------------
// The @amby/db repository layers (VaultStoreLive, CodexAuthStoreLive) provide
// the core tags. By re-exporting the same classes here, the vault service
// layers resolve the identical Context identifiers at runtime, and the type
// system sees one unified class.

export const VaultStore = CoreVaultStore
export type VaultStore = CoreVaultStore

export const CodexAuthStore = CoreCodexAuthStore
export type CodexAuthStore = CoreCodexAuthStore
