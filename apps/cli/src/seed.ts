import { DbService, DbServiceLive, eq, schema } from "@amby/db"
import { EnvServiceLive } from "@amby/env"
import { Effect, Layer } from "effect"

const SEED_USERS = [{ id: "demo", name: "Demo User", email: "demo@amby.local" }] as const

const seed = Effect.gen(function* () {
	const { query } = yield* DbService

	console.log("Seeding database...\n")

	for (const user of SEED_USERS) {
		const existing = yield* query((db) =>
			db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, user.id)),
		)

		if (existing.length > 0) {
			console.log(`  [skip] ${user.name} (${user.id}) — already exists`)
		} else {
			yield* query((db) => db.insert(schema.users).values(user))
			console.log(`  [created] ${user.name} (${user.id})`)
		}
	}

	console.log("\nDone. Users ready:")
	const all = yield* query((db) =>
		db
			.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
			.from(schema.users),
	)
	for (const u of all) {
		console.log(`  ${u.id} — ${u.name} <${u.email}>`)
	}
})

const DbLive = DbServiceLive.pipe(Layer.provide(EnvServiceLive))

Effect.runPromise(seed.pipe(Effect.provide(DbLive)))
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Seed failed:", err)
		process.exit(1)
	})
