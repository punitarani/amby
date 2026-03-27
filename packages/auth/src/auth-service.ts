import { type Database, DbService } from "@amby/db"
import { type Env, EnvService } from "@amby/env"
import type { Auth } from "better-auth"
import { Context, Effect, Layer } from "effect"
import { createAuth } from "./create-auth"
import { createTelegramIdentityService, TelegramIdentityService } from "./telegram/identity-service"

const buildAuth = (db: Database, env: Env): Auth => {
	const telegramIdentity = createTelegramIdentityService(db)
	return createAuth({
		db,
		env,
		telegramIdentity,
	})
}

export class AuthService extends Context.Tag("AuthService")<AuthService, Auth>() {}

export const TelegramIdentityServiceLive = Layer.effect(
	TelegramIdentityService,
	Effect.gen(function* () {
		const { db } = yield* DbService
		return createTelegramIdentityService(db)
	}),
)

export const AuthServiceLive = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const { db } = yield* DbService
		return buildAuth(db, env)
	}),
)

export const AuthLive = Layer.mergeAll(AuthServiceLive, TelegramIdentityServiceLive)

export { buildAuth }
