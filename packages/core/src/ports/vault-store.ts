import { Context, type Effect } from "effect"
import type { DbError } from "../errors/core-error"

export type VaultItemStatus = "active" | "revoked" | "deleted"

export type VaultVersionCreatedByType = "user" | "agent" | "tool" | "system"

export interface VaultItemRow {
	id: string
	userId: string
	namespace: string
	itemKey: string
	displayName: string | null
	kind: string
	metadataJson: unknown
	policyJson: unknown
	currentVersion: number
	status: VaultItemStatus
	createdAt: Date
	updatedAt: Date
}

export interface VaultVersionRow {
	id: string
	vaultId: string
	version: number
	cryptoAlg: string
	kekVersion: number
	dekWrapped: string
	nonce: string
	ciphertext: string
	createdByType: VaultVersionCreatedByType
	createdById: string | null
	createdAt: Date
}

export interface VaultAccessLogInput {
	vaultId: string
	vaultVersionId?: string | null
	action: string
	actorType: string
	actorId?: string | null
	purpose?: string | null
	runId?: string | null
	taskId?: string | null
}

export interface VaultStoreService {
	readonly insertItem: (values: {
		id?: string
		userId: string
		namespace: string
		itemKey: string
		kind: string
		displayName?: string | null
		metadataJson?: unknown
		policyJson?: unknown
		currentVersion: number
		status: VaultItemStatus
	}) => Effect.Effect<VaultItemRow, DbError>

	readonly updateItem: (
		id: string,
		set: Partial<
			Pick<
				VaultItemRow,
				"currentVersion" | "status" | "displayName" | "metadataJson" | "policyJson" | "itemKey"
			>
		>,
	) => Effect.Effect<void, DbError>

	readonly getItemById: (id: string) => Effect.Effect<VaultItemRow | null, DbError>

	readonly getItemByKey: (
		userId: string,
		namespace: string,
		itemKey: string,
	) => Effect.Effect<VaultItemRow | null, DbError>

	readonly listItems: (
		userId: string,
		filters?: { namespace?: string; status?: VaultItemStatus },
	) => Effect.Effect<VaultItemRow[], DbError>

	readonly insertVersion: (values: {
		id?: string
		vaultId: string
		version: number
		cryptoAlg?: string
		kekVersion: number
		dekWrapped: string
		nonce: string
		ciphertext: string
		createdByType?: VaultVersionCreatedByType
		createdById?: string | null
	}) => Effect.Effect<VaultVersionRow, DbError>

	readonly getVersion: (
		vaultId: string,
		version: number,
	) => Effect.Effect<VaultVersionRow | null, DbError>

	readonly getLatestVersion: (vaultId: string) => Effect.Effect<VaultVersionRow | null, DbError>

	readonly insertAccessLog: (values: VaultAccessLogInput) => Effect.Effect<void, DbError>
}

export class VaultStore extends Context.Tag("VaultStore")<VaultStore, VaultStoreService>() {}
