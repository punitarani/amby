import type { CodexAuthStateRow, CodexAuthStoreService } from "@amby/core"
import { CodexAuthStore } from "@amby/core"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as schema from "../schema"
import { DbService } from "../service"

export const CodexAuthStoreLive = Layer.effect(
	CodexAuthStore,
	Effect.gen(function* () {
		const { query } = yield* DbService

		const service: CodexAuthStoreService = {
			getByUserId: (userId) =>
				query(async (d) => {
					const rows = await d
						.select()
						.from(schema.codexAuthStates)
						.where(eq(schema.codexAuthStates.userId, userId))
						.limit(1)
					return (rows[0] as CodexAuthStateRow | undefined) ?? null
				}),

			upsert: (userId, values) =>
				query(async (d) => {
					const rows = await d
						.insert(schema.codexAuthStates)
						.values({ userId, ...values })
						.onConflictDoUpdate({
							target: schema.codexAuthStates.userId,
							set: {
								...values,
								updatedAt: new Date(),
							},
						})
						.returning()

					const row = rows[0]
					if (!row) {
						throw new Error(`Failed to upsert codex auth state for user ${userId}`)
					}
					return row as CodexAuthStateRow
				}),
		}

		return service
	}),
)
