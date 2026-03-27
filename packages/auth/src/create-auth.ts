import type { Database } from "@amby/db"
import type { Env } from "@amby/env"
import { apiKey } from "@better-auth/api-key"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { genericOAuth } from "better-auth/plugins/generic-oauth"
import type { TelegramIdentityServiceApi } from "./telegram/identity-service"
import { createTelegramOidcConfig } from "./telegram/oidc"
import { telegram } from "./telegram/plugin"
import { getAuthTrustedOrigins } from "./trusted-origins"

export interface CreateAuthOptions {
	db: Database
	env: Env
	telegramIdentity: TelegramIdentityServiceApi
}

// Return type annotated because betterAuth()'s inferred type references internal
// better-call types that are not portable in workspace package boundaries.
export const createAuth = ({ db, env, telegramIdentity }: CreateAuthOptions) => {
	const telegramOidcConfig = createTelegramOidcConfig(env)

	return betterAuth({
		database: drizzleAdapter(db, { provider: "pg" }),
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		trustedOrigins: getAuthTrustedOrigins(env),
		emailAndPassword: { enabled: true },
		plugins: [
			apiKey(),
			telegram({
				env,
				telegramIdentity,
			}),
			...(telegramOidcConfig
				? [
						genericOAuth({
							config: [telegramOidcConfig],
						}),
					]
				: []),
		],
	}) as unknown as ReturnType<typeof betterAuth>
}
