import { type Database, DbService } from "@amby/db"
import { EnvService } from "@amby/env"
import { apiKey } from "@better-auth/api-key"
import type { Auth } from "better-auth"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { Context, Effect, Layer } from "effect"

// Return type annotated as Auth because betterAuth()'s inferred type references
// internal better-call types that TypeScript cannot serialize portably.
const createAuth = (db: Database, secret: string, baseURL: string): Auth =>
	betterAuth({
		database: drizzleAdapter(db, { provider: "pg" }),
		secret,
		baseURL,
		emailAndPassword: { enabled: true },
		plugins: [apiKey()],
	}) as unknown as Auth

export class AuthService extends Context.Tag("AuthService")<AuthService, Auth>() {}

export const AuthServiceLive = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const { db } = yield* DbService
		return createAuth(db, env.BETTER_AUTH_SECRET, env.BETTER_AUTH_URL)
	}),
)
