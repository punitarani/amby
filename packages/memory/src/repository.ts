import { and, DbService, desc, eq, schema } from "@amby/db"
import { Context, Effect, Layer } from "effect"
import { MemoryError } from "./errors"
import type { MemoryCategory, MemoryItem } from "./types"

export class MemoryService extends Context.Tag("MemoryService")<
	MemoryService,
	{
		readonly add: (
			userId: string,
			content: string,
			category?: MemoryCategory,
			source?: string,
			metadata?: Record<string, unknown>,
		) => Effect.Effect<string, MemoryError>
		readonly getProfile: (
			userId: string,
		) => Effect.Effect<{ static: MemoryItem[]; dynamic: MemoryItem[] }, MemoryError>
		readonly deactivate: (id: string) => Effect.Effect<void, MemoryError>
	}
>() {}

export const MemoryServiceLive = Layer.effect(
	MemoryService,
	Effect.gen(function* () {
		const { query } = yield* DbService

		return {
			add: (userId, content, category = "dynamic", source?, metadata?) =>
				Effect.gen(function* () {
					const rows = yield* query((db) =>
						db
							.insert(schema.memories)
							.values({ userId, content, category, source, metadata })
							.returning({ id: schema.memories.id }),
					)
					const row = rows[0]
					if (!row)
						return yield* Effect.fail(new MemoryError({ message: "Insert returned no rows" }))
					return row.id
				}).pipe(
					Effect.mapError((e) => new MemoryError({ message: "Failed to add memory", cause: e })),
				),

			getProfile: (userId) =>
				Effect.gen(function* () {
					const rows = yield* query((db) =>
						db
							.select()
							.from(schema.memories)
							.where(and(eq(schema.memories.userId, userId), eq(schema.memories.isActive, true)))
							.orderBy(desc(schema.memories.updatedAt)),
					)

					const staticMems: MemoryItem[] = []
					const dynamicMems: MemoryItem[] = []

					for (const row of rows) {
						const item: MemoryItem = {
							id: row.id,
							content: row.content,
							category: row.category,
							metadata: row.metadata ?? undefined,
						}
						if (row.category === "static") staticMems.push(item)
						else dynamicMems.push(item)
					}

					return { static: staticMems, dynamic: dynamicMems }
				}).pipe(
					Effect.mapError(
						(e) => new MemoryError({ message: "Failed to get memory profile", cause: e }),
					),
				),

			deactivate: (id) =>
				query((db) =>
					db
						.update(schema.memories)
						.set({ isActive: false, updatedAt: new Date() })
						.where(eq(schema.memories.id, id)),
				).pipe(
					Effect.asVoid,
					Effect.mapError(
						(e) => new MemoryError({ message: "Failed to deactivate memory", cause: e }),
					),
				),
		}
	}),
)
