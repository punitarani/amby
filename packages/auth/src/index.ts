import { type Database, DbService, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { apiKey } from "@better-auth/api-key"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"
import { Context, Effect, Layer } from "effect"

const createAuth = (db: Database, secret: string, baseURL: string) =>
	betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: {
				...schema,
				user: schema.users,
				session: schema.sessions,
				account: schema.accounts,
				verification: schema.verifications,
			},
		}),
		secret,
		baseURL,
		emailAndPassword: { enabled: true },
		plugins: [admin(), apiKey()],
	})

type AuthInstance = ReturnType<typeof createAuth>

export class AuthService extends Context.Tag("AuthService")<AuthService, AuthInstance>() {}

export const AuthServiceLive = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const { db } = yield* DbService
		return createAuth(db, env.BETTER_AUTH_SECRET, env.BETTER_AUTH_URL)
	}),
)
