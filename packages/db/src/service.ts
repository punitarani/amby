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
					catch: (cause) => new DbError({ message: "Database query failed", cause }),
				}),
		}
	}),
)
