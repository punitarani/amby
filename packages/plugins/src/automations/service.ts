import type { AutomationStatus } from "@amby/core"
import { and, DbService, desc, eq, isNotNull, lte, schema } from "@amby/db"
import { Context, Effect, Layer } from "effect"
import { AutomationError } from "./errors"

type AutomationRow = typeof schema.automations.$inferSelect

export class AutomationService extends Context.Tag("AutomationService")<
	AutomationService,
	{
		readonly create: (
			params: typeof schema.automations.$inferInsert,
		) => Effect.Effect<AutomationRow, AutomationError>
		readonly findById: (id: string) => Effect.Effect<AutomationRow | undefined, AutomationError>
		readonly findByUser: (
			userId: string,
			options?: { status?: AutomationStatus },
		) => Effect.Effect<AutomationRow[], AutomationError>
		readonly findDue: (asOf: Date) => Effect.Effect<AutomationRow[], AutomationError>
		readonly updateStatus: (
			id: string,
			status: AutomationStatus,
			fields?: { lastRunAt?: Date; nextRunAt?: Date | null },
		) => Effect.Effect<void, AutomationError>
		readonly delete: (id: string) => Effect.Effect<void, AutomationError>
	}
>() {}

export const AutomationServiceLive = Layer.effect(
	AutomationService,
	Effect.gen(function* () {
		const { query } = yield* DbService

		const mapError = (e: unknown) =>
			new AutomationError({
				message: e instanceof Error ? e.message : "Automation operation failed",
				cause: e,
			})

		return {
			create: (params) =>
				Effect.gen(function* () {
					const rows = yield* query((db) =>
						db.insert(schema.automations).values(params).returning(),
					)
					const row = rows[0]
					if (!row) return yield* new AutomationError({ message: "Insert returned no rows" })
					return row
				}).pipe(Effect.mapError(mapError)),

			findById: (id) =>
				query((db) =>
					db.select().from(schema.automations).where(eq(schema.automations.id, id)).limit(1),
				).pipe(
					Effect.map((rows) => rows[0]),
					Effect.mapError(mapError),
				),

			findByUser: (userId, options) =>
				query((db) => {
					const conditions = [eq(schema.automations.userId, userId)]
					if (options?.status) {
						conditions.push(eq(schema.automations.status, options.status))
					}
					return db
						.select()
						.from(schema.automations)
						.where(and(...conditions))
						.orderBy(desc(schema.automations.createdAt))
				}).pipe(Effect.mapError(mapError)),

			findDue: (asOf) =>
				query((db) =>
					db
						.select()
						.from(schema.automations)
						.where(
							and(
								eq(schema.automations.status, "active"),
								isNotNull(schema.automations.nextRunAt),
								lte(schema.automations.nextRunAt, asOf),
							),
						),
				).pipe(Effect.mapError(mapError)),

			updateStatus: (id, status, fields) =>
				query((db) =>
					db
						.update(schema.automations)
						.set({
							status,
							...fields,
							updatedAt: new Date(),
						})
						.where(eq(schema.automations.id, id)),
				).pipe(Effect.asVoid, Effect.mapError(mapError)),

			delete: (id) =>
				query((db) => db.delete(schema.automations).where(eq(schema.automations.id, id))).pipe(
					Effect.asVoid,
					Effect.mapError(mapError),
				),
		}
	}),
)
