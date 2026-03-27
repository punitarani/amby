import type { Env } from "@amby/env"
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import type { BetterAuthPlugin } from "better-auth/types"
import { TELEGRAM_PROVIDER_ID } from "./constants"
import type { TelegramIdentityServiceApi } from "./identity-service"
import { telegramMiniAppSignInSchema, telegramWidgetEndpointBodySchema } from "./schemas"
import {
	parseTelegramMiniAppProfile,
	parseTelegramWidgetProfile,
	verifyTelegramMiniAppInitData,
	verifyTelegramWidgetAuth,
} from "./verification"

export interface TelegramPluginOptions {
	env: Pick<
		Env,
		| "TELEGRAM_BOT_TOKEN"
		| "TELEGRAM_BOT_USERNAME"
		| "TELEGRAM_MAX_AUTH_AGE_SECONDS"
		| "TELEGRAM_LOGIN_WIDGET_ENABLED"
		| "TELEGRAM_MINI_APP_ENABLED"
		| "TELEGRAM_OIDC_CLIENT_ID"
		| "TELEGRAM_OIDC_CLIENT_SECRET"
	>
	telegramIdentity: TelegramIdentityServiceApi
}

const getMaxAuthAgeSeconds = (env: Pick<Env, "TELEGRAM_MAX_AUTH_AGE_SECONDS">) =>
	env.TELEGRAM_MAX_AUTH_AGE_SECONDS || 24 * 60 * 60

const assertTelegramConfigured = (
	env: Pick<Env, "TELEGRAM_BOT_TOKEN" | "TELEGRAM_BOT_USERNAME">,
) => {
	if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME) {
		throw APIError.fromStatus("SERVICE_UNAVAILABLE", {
			message: "Telegram auth is not configured",
		})
	}
}

const assertTrustedOrigin = (ctx: {
	headers?: Headers
	context: {
		isTrustedOrigin: (url: string, settings?: { allowRelativePaths: boolean }) => boolean
	}
}) => {
	const origin = ctx.headers?.get("origin")
	if (!origin) {
		return
	}
	if (!ctx.context.isTrustedOrigin(origin, { allowRelativePaths: false })) {
		throw APIError.fromStatus("FORBIDDEN", {
			message: "Request origin is not trusted",
		})
	}
}

type SessionCookieContext = Parameters<typeof setSessionCookie>[0] & {
	context: {
		internalAdapter: {
			createSession: (userId: string, dontRememberMe?: boolean) => Promise<unknown>
			findUserById: (userId: string) => Promise<unknown>
		}
	}
}

const createSessionForUser = async (
	ctx: SessionCookieContext,
	userId: string,
	rememberMe?: boolean,
) => {
	const session = await ctx.context.internalAdapter.createSession(userId, rememberMe === false)
	const user = await ctx.context.internalAdapter.findUserById(userId)
	if (!user) {
		throw APIError.fromStatus("BAD_REQUEST", {
			message: "Unable to load Better Auth user after Telegram sign-in",
		})
	}
	await setSessionCookie(
		ctx,
		{
			session,
			user,
		},
		rememberMe === false,
	)
	return user
}

export const telegram = ({ env, telegramIdentity }: TelegramPluginOptions) =>
	({
		id: "telegram",
		schema: {
			user: {
				fields: {
					telegramUsername: {
						type: "string",
						required: false,
					},
					telegramPhoneNumber: {
						type: "string",
						required: false,
					},
				},
			},
			account: {
				fields: {
					telegramChatId: {
						type: "string",
						required: false,
					},
				},
			},
		},
		rateLimit: [
			{
				pathMatcher: (path) => path === "/telegram/signin" || path === "/telegram/miniapp/signin",
				max: 10,
				window: 60,
			},
			{
				pathMatcher: (path) => path === "/telegram/link" || path === "/telegram/unlink",
				max: 5,
				window: 60,
			},
			{
				pathMatcher: (path) => path === "/telegram/miniapp/validate",
				max: 20,
				window: 60,
			},
		],
		endpoints: {
			getTelegramConfig: createAuthEndpoint(
				"/telegram/config",
				{
					method: "GET",
				},
				async (ctx) =>
					ctx.json({
						botUsername: env.TELEGRAM_BOT_USERNAME || null,
						loginWidgetEnabled:
							Boolean(env.TELEGRAM_BOT_TOKEN) && env.TELEGRAM_LOGIN_WIDGET_ENABLED,
						miniAppEnabled: Boolean(env.TELEGRAM_BOT_TOKEN) && env.TELEGRAM_MINI_APP_ENABLED,
						oidcEnabled: Boolean(
							(env.TELEGRAM_OIDC_CLIENT_ID || env.TELEGRAM_BOT_TOKEN.split(":")[0] || "") &&
								env.TELEGRAM_OIDC_CLIENT_SECRET,
						),
						providerId: TELEGRAM_PROVIDER_ID,
					}),
			),
			signInWithTelegram: createAuthEndpoint(
				"/telegram/signin",
				{
					method: "POST",
					body: telegramWidgetEndpointBodySchema,
				},
				async (ctx) => {
					assertTelegramConfigured(env)
					if (!env.TELEGRAM_LOGIN_WIDGET_ENABLED) {
						throw APIError.fromStatus("BAD_REQUEST", {
							message: "Telegram Login Widget is disabled",
						})
					}
					assertTrustedOrigin(ctx)

					await verifyTelegramWidgetAuth(ctx.body, {
						botToken: env.TELEGRAM_BOT_TOKEN,
						maxAuthAgeSeconds: getMaxAuthAgeSeconds(env),
					})

					const result = await telegramIdentity.signInOrCreate({
						source: "widget",
						profile: parseTelegramWidgetProfile(ctx.body),
					})
					const user = await createSessionForUser(ctx, result.userId, ctx.body.rememberMe)

					return ctx.json({
						user,
						created: result.created,
					})
				},
			),
			linkTelegram: createAuthEndpoint(
				"/telegram/link",
				{
					method: "POST",
					use: [sessionMiddleware],
					body: telegramWidgetEndpointBodySchema,
				},
				async (ctx) => {
					assertTelegramConfigured(env)
					if (!env.TELEGRAM_LOGIN_WIDGET_ENABLED) {
						throw APIError.fromStatus("BAD_REQUEST", {
							message: "Telegram Login Widget is disabled",
						})
					}
					assertTrustedOrigin(ctx)

					await verifyTelegramWidgetAuth(ctx.body, {
						botToken: env.TELEGRAM_BOT_TOKEN,
						maxAuthAgeSeconds: getMaxAuthAgeSeconds(env),
					})

					const session = ctx.context.session
					await telegramIdentity.linkToUser(session.user.id, {
						source: "widget",
						profile: parseTelegramWidgetProfile(ctx.body),
					})

					return ctx.json({ linked: true })
				},
			),
			unlinkTelegram: createAuthEndpoint(
				"/telegram/unlink",
				{
					method: "POST",
					use: [sessionMiddleware],
				},
				async (ctx) => {
					assertTrustedOrigin(ctx)
					await telegramIdentity.unlinkFromUser(ctx.context.session.user.id)
					return ctx.json({ unlinked: true })
				},
			),
			signInWithTelegramMiniApp: createAuthEndpoint(
				"/telegram/miniapp/signin",
				{
					method: "POST",
					body: telegramMiniAppSignInSchema,
				},
				async (ctx) => {
					assertTelegramConfigured(env)
					if (!env.TELEGRAM_MINI_APP_ENABLED) {
						throw APIError.fromStatus("BAD_REQUEST", {
							message: "Telegram Mini App sign-in is disabled",
						})
					}
					assertTrustedOrigin(ctx)

					const payload = await verifyTelegramMiniAppInitData(ctx.body.initData, {
						botToken: env.TELEGRAM_BOT_TOKEN,
						maxAuthAgeSeconds: getMaxAuthAgeSeconds(env),
					})

					const result = await telegramIdentity.signInOrCreate({
						source: "miniapp",
						profile: parseTelegramMiniAppProfile(payload),
					})
					const user = await createSessionForUser(ctx, result.userId)

					return ctx.json({
						user,
						created: result.created,
					})
				},
			),
			validateTelegramMiniApp: createAuthEndpoint(
				"/telegram/miniapp/validate",
				{
					method: "POST",
					body: telegramMiniAppSignInSchema,
				},
				async (ctx) => {
					assertTelegramConfigured(env)
					if (!env.TELEGRAM_MINI_APP_ENABLED) {
						throw APIError.fromStatus("BAD_REQUEST", {
							message: "Telegram Mini App validation is disabled",
						})
					}
					assertTrustedOrigin(ctx)

					const payload = await verifyTelegramMiniAppInitData(ctx.body.initData, {
						botToken: env.TELEGRAM_BOT_TOKEN,
						maxAuthAgeSeconds: getMaxAuthAgeSeconds(env),
					})
					return ctx.json({
						valid: true,
						profile: parseTelegramMiniAppProfile(payload),
					})
				},
			),
		},
	}) satisfies BetterAuthPlugin
