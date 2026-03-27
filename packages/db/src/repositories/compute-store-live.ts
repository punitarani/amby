import type { ComputeStoreService, ComputeVolume } from "@amby/core"
import { ComputeStore } from "@amby/core"
import { and, eq, lte, ne } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as schema from "../schema"
import { DbService } from "../service"

export const ComputeStoreLive = Layer.effect(
	ComputeStore,
	Effect.gen(function* () {
		const { query } = yield* DbService

		const service: ComputeStoreService = {
			getVolume: (userId) =>
				query(async (d) => {
					const rows = await d
						.select()
						.from(schema.computeVolumes)
						.where(eq(schema.computeVolumes.userId, userId))
						.limit(1)
					return (rows[0] as ComputeVolume | undefined) ?? null
				}),

			upsertVolume: (userId, externalVolumeId, status) =>
				query(async (d) => {
					const rows = await d
						.insert(schema.computeVolumes)
						.values({ userId, externalVolumeId, status })
						.onConflictDoUpdate({
							target: schema.computeVolumes.userId,
							set: {
								externalVolumeId,
								status,
								updatedAt: new Date(),
							},
						})
						.returning()

					const row = rows[0]
					if (!row) {
						throw new Error(`Failed to upsert volume row for user ${userId}.`)
					}
					return row as ComputeVolume
				}),

			upsertMainInstance: (params) => {
				const now = new Date()
				return query((d) =>
					d
						.insert(schema.computeInstances)
						.values({
							userId: params.userId,
							externalInstanceId: params.externalInstanceId,
							volumeId: params.volumeId,
							role: "main",
							status: params.status,
							snapshot: params.snapshot,
							lastActivityAt: now,
							updatedAt: now,
						})
						.onConflictDoUpdate({
							target: [schema.computeInstances.userId, schema.computeInstances.role],
							targetWhere: and(
								eq(schema.computeInstances.role, "main"),
								ne(schema.computeInstances.status, "deleted"),
							),
							set: {
								externalInstanceId: params.externalInstanceId,
								volumeId: params.volumeId,
								status: params.status,
								snapshot: params.snapshot,
								lastActivityAt: now,
								updatedAt: now,
							},
						}),
				).pipe(Effect.asVoid)
			},

			claimProvisionSlot: (userId, throttleCutoff) => {
				const now = new Date()
				return query(async (d) => {
					const claimed = await d
						.update(schema.computeInstances)
						.set({ updatedAt: now })
						.where(
							and(
								eq(schema.computeInstances.userId, userId),
								eq(schema.computeInstances.role, "main"),
								ne(schema.computeInstances.status, "deleted"),
								ne(schema.computeInstances.status, "running"),
								ne(schema.computeInstances.status, "stopped"),
								ne(schema.computeInstances.status, "archived"),
								lte(schema.computeInstances.updatedAt, throttleCutoff),
							),
						)
						.returning({ id: schema.computeInstances.id })
					return claimed.length > 0
				})
			},

			mainInstanceExists: (userId) =>
				query(async (d) => {
					const rows = await d
						.select({ id: schema.computeInstances.id })
						.from(schema.computeInstances)
						.where(
							and(
								eq(schema.computeInstances.userId, userId),
								eq(schema.computeInstances.role, "main"),
								ne(schema.computeInstances.status, "deleted"),
							),
						)
						.limit(1)
					return rows.length > 0
				}),

			loadAuthConfig: (userId) =>
				query(async (d) => {
					const rows = await d
						.select({ authConfig: schema.computeVolumes.authConfig })
						.from(schema.computeVolumes)
						.where(eq(schema.computeVolumes.userId, userId))
						.limit(1)
					return rows[0]?.authConfig ?? null
				}),

			saveAuthConfig: (userId, authConfig) =>
				query((d) =>
					d
						.update(schema.computeVolumes)
						.set({
							authConfig: authConfig as Record<string, unknown> | null,
							updatedAt: new Date(),
						})
						.where(eq(schema.computeVolumes.userId, userId)),
				).pipe(Effect.asVoid),
		}

		return service
	}),
)
