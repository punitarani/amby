import type { VaultItemRow, VaultStoreService, VaultVersionRow } from "@amby/core"
import { VaultStore } from "@amby/core"
import { and, desc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as schema from "../schema"
import { DbService } from "../service"

export const VaultStoreLive = Layer.effect(
	VaultStore,
	Effect.gen(function* () {
		const { query } = yield* DbService

		const service: VaultStoreService = {
			insertItem: (values) =>
				query(async (d) => {
					const rows = await d.insert(schema.vault).values(values).returning()
					const row = rows[0]
					if (!row) {
						throw new Error("Failed to insert vault item")
					}
					return row as VaultItemRow
				}),

			updateItem: (id, set) =>
				query((d) =>
					d
						.update(schema.vault)
						.set({ ...set, updatedAt: new Date() })
						.where(eq(schema.vault.id, id)),
				).pipe(Effect.asVoid),

			getItemById: (id) =>
				query(async (d) => {
					const rows = await d
						.select()
						.from(schema.vault)
						.where(eq(schema.vault.id, id))
						.limit(1)
					return (rows[0] as VaultItemRow | undefined) ?? null
				}),

			getItemByKey: (userId, namespace, itemKey) =>
				query(async (d) => {
					const rows = await d
						.select()
						.from(schema.vault)
						.where(
							and(
								eq(schema.vault.userId, userId),
								eq(schema.vault.namespace, namespace),
								eq(schema.vault.itemKey, itemKey),
							),
						)
						.limit(1)
					return (rows[0] as VaultItemRow | undefined) ?? null
				}),

			listItems: (userId, filters) =>
				query(async (d) => {
					const conditions = [eq(schema.vault.userId, userId)]
					if (filters?.namespace) {
						conditions.push(eq(schema.vault.namespace, filters.namespace))
					}
					if (filters?.status) {
						conditions.push(eq(schema.vault.status, filters.status))
					}
					const rows = await d
						.select()
						.from(schema.vault)
						.where(and(...conditions))
					return rows as VaultItemRow[]
				}),

			insertVersion: (values) =>
				query(async (d) => {
					const rows = await d
						.insert(schema.vaultVersions)
						.values(values)
						.returning()
					const row = rows[0]
					if (!row) {
						throw new Error("Failed to insert vault version")
					}
					return row as VaultVersionRow
				}),

			getVersion: (vaultId, version) =>
				query(async (d) => {
					const rows = await d
						.select()
						.from(schema.vaultVersions)
						.where(
							and(
								eq(schema.vaultVersions.vaultId, vaultId),
								eq(schema.vaultVersions.version, version),
							),
						)
						.limit(1)
					return (rows[0] as VaultVersionRow | undefined) ?? null
				}),

			getLatestVersion: (vaultId) =>
				query(async (d) => {
					const rows = await d
						.select()
						.from(schema.vaultVersions)
						.where(eq(schema.vaultVersions.vaultId, vaultId))
						.orderBy(desc(schema.vaultVersions.version))
						.limit(1)
					return (rows[0] as VaultVersionRow | undefined) ?? null
				}),

			insertAccessLog: (values) =>
				query((d) => d.insert(schema.vaultAccessLog).values(values)).pipe(
					Effect.asVoid,
				),
		}

		return service
	}),
)
