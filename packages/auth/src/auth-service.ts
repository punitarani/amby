import { DbService } from "@amby/db"
import { EnvService } from "@amby/env"
import type { Auth } from "better-auth"
import { Context, Effect, Layer } from "effect"
import { createAuth } from "./create-auth"
import { createTelegramIdentityService, TelegramIdentityService } from "./telegram/identity-service"

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
		const telegramIdentity = yield* TelegramIdentityService
		return createAuth({ db, env, telegramIdentity })
	}),
)

export const AuthLive = AuthServiceLive.pipe(Layer.provideMerge(TelegramIdentityServiceLive))
