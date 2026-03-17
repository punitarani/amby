import { EnvService } from "@amby/env"
import { drizzle } from "drizzle-orm/postgres-js"
import { Context, Effect, Layer } from "effect"
import postgres from "postgres"
import { DbError } from "./errors"
import * as schema from "./schema"

export type Database = ReturnType<typeof drizzle<typeof schema>>

export class DbService extends Context.Tag("DbService")<
	DbService,
	{
		readonly db: Database
		readonly query: <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, DbError>
	}
>() {}

/** For CLI / non-Worker environments — reads DATABASE_URL from EnvService */
export const DbServiceLive = Layer.effect(
	DbService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const client = postgres(env.DATABASE_URL)
		const db = drizzle(client, { schema })

		return {
			db,
			query: <T>(fn: (db: Database) => Promise<T>) =>
				Effect.tryPromise({
					try: () => fn(db),
					catch: (cause) =>
						new DbError({
							message: `Database query failed: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				}),
		}
	}),
)

/**
 * For Cloudflare Workers — pass `env.HYPERDRIVE.connectionString` directly.
 * Follows Cloudflare's recommended Hyperdrive + postgres.js configuration:
 * - max: 5 to stay within Workers' concurrent connection limits
 * - fetch_types: false to skip unnecessary round-trip
 */
export const makeDbServiceFromHyperdrive = (connectionString: string) =>
	Layer.succeed(
		DbService,
		(() => {
			const client = postgres(connectionString, {
				max: 5,
				fetch_types: false,
				prepare: false,
			})
			const db = drizzle(client, { schema })
			return {
				db,
				query: <T>(fn: (db: Database) => Promise<T>) =>
					Effect.tryPromise({
						try: () => fn(db),
						catch: (cause) =>
							new DbError({
								message: `Database query failed: ${cause instanceof Error ? cause.message : String(cause)}`,
								cause,
							}),
					}),
			}
		})(),
	)
