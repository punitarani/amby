import type { VaultItemRow, VaultVersionRow } from "@amby/core"
import { EnvService } from "@amby/env"
import { Context, Effect, Layer } from "effect"
import { buildAad, decrypt, encrypt, generateDek, importKek, unwrapDek, wrapDek } from "./crypto"
import { VaultError, vaultErrorFrom } from "./errors"
import type {
	VaultAccessLogEntry,
	VaultActorType,
	VaultItem,
	VaultKind,
	VaultNamespace,
	VaultVersion,
} from "./types"
import { VaultStore } from "./types"

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class VaultService extends Context.Tag("VaultService")<
	VaultService,
	{
		readonly createItem: (params: {
			userId: string
			namespace: VaultNamespace
			itemKey: string
			kind: VaultKind
			displayName?: string
			metadataJson?: Record<string, unknown>
			policyJson?: Record<string, unknown>
			plaintext: Uint8Array
			actorType?: VaultActorType
			actorId?: string
		}) => Effect.Effect<VaultItem, VaultError>

		readonly createVersion: (params: {
			userId: string
			vaultId: string
			plaintext: Uint8Array
			kind: VaultKind
			actorType?: VaultActorType
			actorId?: string
		}) => Effect.Effect<VaultVersion, VaultError>

		readonly getItem: (
			userId: string,
			vaultId: string,
		) => Effect.Effect<VaultItem | null, VaultError>

		readonly getItemByKey: (
			userId: string,
			namespace: VaultNamespace,
			itemKey: string,
		) => Effect.Effect<VaultItem | null, VaultError>

		readonly resolveSecret: (params: {
			userId: string
			vaultId: string
			version?: number
			purpose?: string
			actorType?: VaultActorType
			actorId?: string
		}) => Effect.Effect<Uint8Array, VaultError>

		readonly revokeItem: (userId: string, vaultId: string) => Effect.Effect<void, VaultError>

		readonly logAccess: (entry: VaultAccessLogEntry) => Effect.Effect<void, VaultError>
	}
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toBase64 = (data: Uint8Array): string => Buffer.from(data).toString("base64")

const fromBase64 = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, "base64"))

const mapErr = vaultErrorFrom

// Core VaultStoreService returns VaultItemRow / VaultVersionRow whose field
// types are wider (e.g. `metadataJson: unknown`) than the vault-domain
// VaultItem / VaultVersion interfaces.  The runtime shapes are identical, so
// a safe cast bridges the gap without duplicating the Context tag.
const toItem = (row: VaultItemRow): VaultItem => row as unknown as VaultItem
const toItemOrNull = (row: VaultItemRow | null): VaultItem | null =>
	row ? (row as unknown as VaultItem) : null
const toVersion = (row: VaultVersionRow): VaultVersion => row as unknown as VaultVersion

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const VaultServiceLive = Layer.effect(
	VaultService,
	Effect.gen(function* () {
		const store = yield* VaultStore
		const env = yield* EnvService

		const kekBase64 = env.VAULT_KEK
		if (!kekBase64) {
			return yield* new VaultError({ message: "VAULT_KEK environment variable is not set" })
		}
		const kekVersion = env.VAULT_KEK_VERSION

		const kek = yield* Effect.tryPromise({
			try: () => importKek(kekBase64),
			catch: mapErr,
		})

		// --- encrypt helpers ------------------------------------------------

		const encryptAndWrap = (params: {
			plaintext: Uint8Array
			vaultId: string
			userId: string
			version: number
			kind: string
		}) =>
			Effect.tryPromise({
				try: async () => {
					const dek = await generateDek()
					const aad = buildAad({
						vaultId: params.vaultId,
						userId: params.userId,
						version: params.version,
						kind: params.kind,
					})
					const { ciphertext, nonce } = await encrypt({
						plaintext: params.plaintext,
						dek,
						aad,
					})
					const dekWrapped = await wrapDek({ dek, kek })
					return {
						dekWrapped: toBase64(dekWrapped),
						nonce: toBase64(nonce),
						ciphertext: toBase64(ciphertext),
					}
				},
				catch: mapErr,
			})

		const decryptFromVersion = (version: VaultVersion, userId: string, kind: string) =>
			Effect.tryPromise({
				try: async () => {
					const wrapped = fromBase64(version.dekWrapped)
					const dek = await unwrapDek({ wrapped, kek })
					const aad = buildAad({
						vaultId: version.vaultId,
						userId,
						version: version.version,
						kind,
					})
					return await decrypt({
						ciphertext: fromBase64(version.ciphertext),
						nonce: fromBase64(version.nonce),
						dek,
						aad,
					})
				},
				catch: mapErr,
			})

		// --- service methods ------------------------------------------------

		return {
			createItem: (params) =>
				Effect.gen(function* () {
					const vaultId = crypto.randomUUID()
					const version = 1

					const encrypted = yield* encryptAndWrap({
						plaintext: params.plaintext,
						vaultId,
						userId: params.userId,
						version,
						kind: params.kind,
					})

					const row = yield* store
						.insertItem({
							id: vaultId,
							userId: params.userId,
							namespace: params.namespace,
							itemKey: params.itemKey,
							kind: params.kind,
							displayName: params.displayName ?? null,
							metadataJson: params.metadataJson ?? null,
							policyJson: params.policyJson ?? null,
							currentVersion: version,
							status: "active",
						})
						.pipe(Effect.mapError(mapErr))

					const ver = yield* store
						.insertVersion({
							id: crypto.randomUUID(),
							vaultId: row.id,
							version,
							cryptoAlg: "AES-256-GCM",
							kekVersion,
							dekWrapped: encrypted.dekWrapped,
							nonce: encrypted.nonce,
							ciphertext: encrypted.ciphertext,
							createdByType: params.actorType ?? "system",
							createdById: params.actorId ?? null,
						})
						.pipe(Effect.mapError(mapErr))

					yield* store
						.insertAccessLog({
							vaultId: row.id,
							vaultVersionId: ver.id,
							action: "create",
							actorType: params.actorType ?? "system",
							actorId: params.actorId ?? null,
						})
						.pipe(Effect.mapError(mapErr))

					return toItem(row)
				}),

			createVersion: (params) =>
				Effect.gen(function* () {
					const existing = yield* store.getItemById(params.vaultId).pipe(Effect.mapError(mapErr))
					if (!existing || existing.userId !== params.userId) {
						return yield* new VaultError({
							message: `Vault item not found: ${params.vaultId}`,
						})
					}

					const nextVersion = existing.currentVersion + 1

					const encrypted = yield* encryptAndWrap({
						plaintext: params.plaintext,
						vaultId: params.vaultId,
						userId: params.userId,
						version: nextVersion,
						kind: params.kind,
					})

					const vaultVersion = yield* store
						.insertVersion({
							id: crypto.randomUUID(),
							vaultId: params.vaultId,
							version: nextVersion,
							cryptoAlg: "AES-256-GCM",
							kekVersion,
							dekWrapped: encrypted.dekWrapped,
							nonce: encrypted.nonce,
							ciphertext: encrypted.ciphertext,
							createdByType: params.actorType ?? "system",
							createdById: params.actorId ?? null,
						})
						.pipe(Effect.mapError(mapErr))

					yield* store
						.updateItem(params.vaultId, { currentVersion: nextVersion })
						.pipe(Effect.mapError(mapErr))

					yield* store
						.insertAccessLog({
							vaultId: params.vaultId,
							vaultVersionId: vaultVersion.id,
							action: "create",
							actorType: params.actorType ?? "system",
							actorId: params.actorId ?? null,
						})
						.pipe(Effect.mapError(mapErr))

					return toVersion(vaultVersion)
				}),

			getItem: (userId, vaultId) =>
				store.getItemById(vaultId).pipe(
					Effect.map((item) => (item && item.userId === userId ? toItem(item) : null)),
					Effect.mapError(mapErr),
				),

			getItemByKey: (userId, namespace, itemKey) =>
				store
					.getItemByKey(userId, namespace, itemKey)
					.pipe(Effect.map(toItemOrNull), Effect.mapError(mapErr)),

			resolveSecret: (params) =>
				Effect.gen(function* () {
					const item = yield* store.getItemById(params.vaultId).pipe(Effect.mapError(mapErr))
					if (!item || item.userId !== params.userId) {
						return yield* new VaultError({
							message: `Vault item not found: ${params.vaultId}`,
						})
					}

					const version = params.version
						? yield* store.getVersion(params.vaultId, params.version).pipe(Effect.mapError(mapErr))
						: yield* store.getLatestVersion(params.vaultId).pipe(Effect.mapError(mapErr))

					if (!version) {
						return yield* new VaultError({
							message: `Vault version not found for ${params.vaultId}`,
						})
					}

					const plaintext = yield* decryptFromVersion(toVersion(version), params.userId, item.kind)

					yield* store
						.insertAccessLog({
							vaultId: params.vaultId,
							vaultVersionId: version.id,
							action: "resolve",
							actorType: params.actorType ?? "system",
							actorId: params.actorId ?? null,
							purpose: params.purpose ?? null,
						})
						.pipe(Effect.mapError(mapErr))

					return plaintext
				}),

			revokeItem: (userId, vaultId) =>
				Effect.gen(function* () {
					const item = yield* store.getItemById(vaultId).pipe(Effect.mapError(mapErr))
					if (!item || item.userId !== userId) {
						return yield* new VaultError({ message: `Vault item not found: ${vaultId}` })
					}

					yield* store.updateItem(vaultId, { status: "revoked" }).pipe(Effect.mapError(mapErr))

					yield* store
						.insertAccessLog({
							vaultId,
							action: "revoke",
							actorType: "system",
						})
						.pipe(Effect.mapError(mapErr))
				}),

			logAccess: (entry) => store.insertAccessLog(entry).pipe(Effect.mapError(mapErr)),
		}
	}),
)
