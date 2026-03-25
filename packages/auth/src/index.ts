import { type Database, DbService } from "@amby/db"
import { EnvService } from "@amby/env"
import { apiKey } from "@better-auth/api-key"
import type { Auth } from "better-auth"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { Context, Effect, Layer } from "effect"

const createAuth = (db: Database, secret: string, baseURL: string) =>
	betterAuth({
		database: drizzleAdapter(db, { provider: "pg" }),
		secret,
		baseURL,
		emailAndPassword: { enabled: true },
		plugins: [apiKey()],
	})

export class AuthService extends Context.Tag("AuthService")<AuthService, Auth>() {}

export const AuthServiceLive = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const { db } = yield* DbService
		return createAuth(db, env.BETTER_AUTH_SECRET, env.BETTER_AUTH_URL) as unknown as Auth
	}),
)
