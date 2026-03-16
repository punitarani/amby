import { DbService } from "@amby/db"
import { EnvService } from "@amby/env"
import { type BetterAuthOptions, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { Context, Effect, Layer } from "effect"

export class AuthService extends Context.Tag("AuthService")<
	AuthService,
	ReturnType<typeof betterAuth<BetterAuthOptions>>
>() {}

export const AuthServiceLive = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const { db } = yield* DbService

		return betterAuth({
			database: drizzleAdapter(db, { provider: "pg" }),
			secret: env.BETTER_AUTH_SECRET,
			baseURL: env.BETTER_AUTH_URL,
			emailAndPassword: { enabled: true },
		}) as ReturnType<typeof betterAuth<BetterAuthOptions>>
	}),
)
