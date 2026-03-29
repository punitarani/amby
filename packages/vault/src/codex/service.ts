import { Context, Effect, Layer } from "effect"
import { VaultError, vaultErrorFrom } from "../errors"
import { VaultService } from "../service"
import type { VaultItem, VaultVersion } from "../types"
import { CodexAuthStore, VaultStore } from "../types"
import { parseCodexPayload, serializeCodexPayload } from "./codecs"
import type { CodexCredentialPayload } from "./types"

const NAMESPACE = "codex" as const
const ITEM_KEY = "default" as const

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class CodexVaultService extends Context.Tag("CodexVaultService")<
	CodexVaultService,
	{
		readonly createApiKeyCredential: (
			userId: string,
			apiKey: string,
			displayName?: string,
		) => Effect.Effect<{ vaultItem: VaultItem }, VaultError>

		readonly createChatgptBundleCredential: (
			userId: string,
			archiveBase64: string,
			summary: {
				accountId?: string
				workspaceId?: string
				planType?: string
				lastRefresh?: string
			},
		) => Effect.Effect<{ vaultItem: VaultItem }, VaultError>

		readonly getActiveCredential: (
			userId: string,
		) => Effect.Effect<{ item: VaultItem; version: VaultVersion } | null, VaultError>

		readonly resolveCredential: (
			userId: string,
			vaultId: string,
			version?: number,
		) => Effect.Effect<CodexCredentialPayload, VaultError>

		readonly revokeCredential: (userId: string, vaultId: string) => Effect.Effect<void, VaultError>
	}
>() {}

const mapErr = vaultErrorFrom

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const CodexVaultServiceLive = Layer.effect(
	CodexVaultService,
	Effect.gen(function* () {
		const vault = yield* VaultService
		const authStore = yield* CodexAuthStore
		const vaultStore = yield* VaultStore

		/**
		 * Upsert pattern: look up existing item by key.
		 * - If none exists, create new item.
		 * - If exists with same kind and active, create new version.
		 * - If exists with different kind, revoke old and create new.
		 */
		const upsertCredential = (params: {
			userId: string
			kind: "codex_api_key" | "codex_chatgpt_home"
			plaintext: Uint8Array
			displayName?: string
		}) =>
			Effect.gen(function* () {
				const existing = yield* vault.getItemByKey(params.userId, NAMESPACE, ITEM_KEY)

				if (existing && existing.status === "active" && existing.kind !== params.kind) {
					yield* vault.revokeItem(params.userId, existing.id)
				}

				if (existing && existing.status === "active" && existing.kind === params.kind) {
					yield* vault.createVersion({
						userId: params.userId,
						vaultId: existing.id,
						kind: params.kind,
						plaintext: params.plaintext,
					})
					const updated = yield* vault.getItem(params.userId, existing.id)
					if (!updated) {
						return yield* new VaultError({
							message: "Failed to re-fetch vault item after version create",
						})
					}
					return updated
				}

				return yield* vault.createItem({
					userId: params.userId,
					namespace: NAMESPACE,
					itemKey: ITEM_KEY,
					kind: params.kind,
					displayName: params.displayName,
					plaintext: params.plaintext,
				})
			})

		return {
			createApiKeyCredential: (userId, apiKey, displayName) =>
				Effect.gen(function* () {
					const payload = serializeCodexPayload({
						schemaVersion: 1,
						method: "api_key",
						apiKey,
					})

					const vaultItem = yield* upsertCredential({
						userId,
						kind: "codex_api_key",
						plaintext: payload,
						displayName,
					})

					yield* authStore
						.upsert(userId, {
							method: "api_key",
							status: "authenticated",
							activeVaultId: vaultItem.id,
							activeVaultVersion: vaultItem.currentVersion,
							apiKeyLast4: apiKey.slice(-4),
						})
						.pipe(Effect.mapError(mapErr))

					return { vaultItem }
				}),

			createChatgptBundleCredential: (userId, archiveBase64, summary) =>
				Effect.gen(function* () {
					const payload = serializeCodexPayload({
						schemaVersion: 1,
						method: "chatgpt",
						archiveFormat: "json",
						archiveBase64,
						capturedAt: new Date().toISOString(),
					})

					const vaultItem = yield* upsertCredential({
						userId,
						kind: "codex_chatgpt_home",
						plaintext: payload,
					})

					yield* authStore
						.upsert(userId, {
							method: "chatgpt",
							status: "authenticated",
							activeVaultId: vaultItem.id,
							activeVaultVersion: vaultItem.currentVersion,
							accountId: summary.accountId ?? null,
							workspaceId: summary.workspaceId ?? null,
							planType: summary.planType ?? null,
						})
						.pipe(Effect.mapError(mapErr))

					return { vaultItem }
				}),

			getActiveCredential: (userId) =>
				Effect.gen(function* () {
					const authState = yield* authStore.getByUserId(userId).pipe(Effect.mapError(mapErr))

					if (!authState?.activeVaultId) return null

					const item = yield* vault.getItem(userId, authState.activeVaultId)
					if (!item || item.status !== "active") return null

					const versionNum = authState.activeVaultVersion ?? item.currentVersion
					const version = yield* vaultStore
						.getVersion(item.id, versionNum)
						.pipe(Effect.mapError(mapErr))

					if (!version) return null

					return {
						item,
						version: version as unknown as VaultVersion,
					}
				}),

			resolveCredential: (userId, vaultId, version) =>
				Effect.gen(function* () {
					const raw = yield* vault.resolveSecret({
						userId,
						vaultId,
						version,
						purpose: "codex-credential-resolve",
					})
					return yield* Effect.try({
						try: () => parseCodexPayload(raw),
						catch: (cause) =>
							cause instanceof VaultError
								? cause
								: new VaultError({
										message: "Failed to parse resolved codex credential",
										cause,
									}),
					})
				}),

			revokeCredential: (userId, vaultId) =>
				Effect.gen(function* () {
					const existing = yield* authStore.getByUserId(userId).pipe(Effect.mapError(mapErr))
					const method = existing?.method ?? "api_key"
					yield* vault.revokeItem(userId, vaultId)
					yield* authStore
						.upsert(userId, {
							method,
							status: "revoked",
							activeVaultId: null,
							activeVaultVersion: null,
						})
						.pipe(Effect.mapError(mapErr))
				}),
		}
	}),
)
