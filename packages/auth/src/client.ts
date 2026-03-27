/// <reference lib="dom" />

import type { BetterAuthClientPlugin } from "better-auth/client"
import { createAuthClient } from "better-auth/client"
import { genericOAuthClient } from "better-auth/client/plugins"
import type { telegram } from "./telegram/plugin"
import type { TelegramLoginWidgetOptions, TelegramWidgetAuthData } from "./telegram/types"

type MiniAppActionResult = {
	valid: boolean
	profile: Record<string, unknown>
}

type TelegramConfigResult = {
	botUsername?: string | null
}

type FetchResponse<T> = {
	data?: T
	error?: unknown
}

type FetchAction = (path: string, init?: Record<string, unknown>) => Promise<unknown>

type MiniAppWindow = {
	Telegram?: {
		WebApp?: {
			initData?: string
		}
	}
}

type TelegramAuthClientActions = {
	getTelegramConfig(fetchOptions?: Record<string, unknown>): Promise<unknown>
	signInWithTelegram(
		authData: TelegramWidgetAuthData,
		fetchOptions?: Record<string, unknown>,
	): Promise<unknown>
	linkTelegram(
		authData: TelegramWidgetAuthData,
		fetchOptions?: Record<string, unknown>,
	): Promise<unknown>
	unlinkTelegram(fetchOptions?: Record<string, unknown>): Promise<unknown>
	signInWithMiniApp(initData: string, fetchOptions?: Record<string, unknown>): Promise<unknown>
	validateMiniApp(
		initData: string,
		fetchOptions?: Record<string, unknown>,
	): Promise<{ data?: MiniAppActionResult; error?: unknown }>
	autoSignInFromMiniApp(fetchOptions?: Record<string, unknown>): Promise<unknown>
	signInWithTelegramOIDC(
		options?: {
			callbackURL?: string
			errorCallbackURL?: string
			newUserCallbackURL?: string
			scopes?: string[]
			disableRedirect?: boolean
		},
		fetchOptions?: Record<string, unknown>,
	): Promise<unknown>
	initTelegramWidget(
		containerId: string,
		options: TelegramLoginWidgetOptions,
		onAuth: (authData: TelegramWidgetAuthData) => void | Promise<void>,
	): Promise<void>
	initTelegramWidgetRedirect(
		containerId: string,
		redirectUrl: string,
		options: TelegramLoginWidgetOptions,
	): Promise<void>
}

const TELEGRAM_WIDGET_SCRIPT_ID = "amby-telegram-widget-script"

const getWidgetScriptSrc = () => "https://telegram.org/js/telegram-widget.js?22"

const browserGlobals = globalThis as typeof globalThis & {
	window?: Record<string, unknown> & { location?: { assign: (url: string) => void } }
	document?: {
		createElement: (tagName: string) => {
			id: string
			async: boolean
			src: string
			setAttribute: (name: string, value: string) => void
		}
		getElementById: (id: string) => {
			innerHTML: string
			appendChild: (node: unknown) => void
		} | null
	}
}

const assertBrowser = () => {
	if (!browserGlobals.window || !browserGlobals.document) {
		throw new Error("Telegram widget helpers require a browser environment")
	}
}

const renderWidget = async (
	$fetch: FetchAction,
	containerId: string,
	options: TelegramLoginWidgetOptions,
	onAuth?: (authData: TelegramWidgetAuthData) => void | Promise<void>,
	redirectUrl?: string,
) => {
	assertBrowser()
	const configResult = (await $fetch("/telegram/config", {
		method: "GET",
	})) as FetchResponse<TelegramConfigResult>
	const config = configResult.data

	if (!config?.botUsername) {
		throw new Error("Telegram auth is not configured")
	}

	const container = browserGlobals.document?.getElementById(containerId)
	if (!container) {
		throw new Error(`Telegram widget container not found: ${containerId}`)
	}

	container.innerHTML = ""

	const callbackName = `__ambyTelegramAuth_${crypto.randomUUID().replaceAll("-", "")}`
	if (onAuth) {
		;(browserGlobals.window as Record<string, unknown>)[callbackName] = async (
			authData: TelegramWidgetAuthData,
		) => {
			await onAuth(authData)
		}
	}

	const script = browserGlobals.document?.createElement("script")
	if (!script) {
		throw new Error("Unable to create Telegram widget script element")
	}
	script.id = TELEGRAM_WIDGET_SCRIPT_ID
	script.async = true
	script.src = getWidgetScriptSrc()
	script.setAttribute("data-telegram-login", config.botUsername)
	script.setAttribute("data-size", options.size ?? "large")
	script.setAttribute("data-radius", String(options.cornerRadius ?? 20))
	script.setAttribute("data-request-access", options.requestAccess ?? "write")
	script.setAttribute("data-userpic", options.showUserPhoto === false ? "false" : "true")

	if (redirectUrl) {
		script.setAttribute("data-auth-url", redirectUrl)
	} else if (onAuth) {
		script.setAttribute("data-onauth", `${callbackName}(user)`)
	}

	container.appendChild(script)
}

export const telegramClient = () =>
	({
		id: "telegram",
		$InferServerPlugin: {} as ReturnType<typeof telegram>,
		pathMethods: {
			"/telegram/config": "GET",
		},
		getActions: ($fetch) => ({
			getTelegramConfig: async (fetchOptions?: Record<string, unknown>) =>
				$fetch("/telegram/config", {
					method: "GET",
					...fetchOptions,
				}),
			signInWithTelegram: async (
				authData: TelegramWidgetAuthData,
				fetchOptions?: Record<string, unknown>,
			) =>
				$fetch("/telegram/signin", {
					method: "POST",
					body: authData,
					...fetchOptions,
				}),
			linkTelegram: async (
				authData: TelegramWidgetAuthData,
				fetchOptions?: Record<string, unknown>,
			) =>
				$fetch("/telegram/link", {
					method: "POST",
					body: authData,
					...fetchOptions,
				}),
			unlinkTelegram: async (fetchOptions?: Record<string, unknown>) =>
				$fetch("/telegram/unlink", {
					method: "POST",
					...fetchOptions,
				}),
			signInWithMiniApp: async (initData: string, fetchOptions?: Record<string, unknown>) =>
				$fetch("/telegram/miniapp/signin", {
					method: "POST",
					body: { initData },
					...fetchOptions,
				}),
			validateMiniApp: async (
				initData: string,
				fetchOptions?: Record<string, unknown>,
			): Promise<{ data?: MiniAppActionResult; error?: unknown }> =>
				$fetch("/telegram/miniapp/validate", {
					method: "POST",
					body: { initData },
					...fetchOptions,
				}),
			autoSignInFromMiniApp: async (fetchOptions?: Record<string, unknown>) => {
				const initData = (browserGlobals.window as unknown as MiniAppWindow | undefined)?.Telegram
					?.WebApp?.initData
				if (!initData) {
					throw new Error("Telegram Mini App initData is not available")
				}
				return $fetch("/telegram/miniapp/signin", {
					method: "POST",
					body: { initData },
					...fetchOptions,
				})
			},
			signInWithTelegramOIDC: async (
				options?: {
					callbackURL?: string
					errorCallbackURL?: string
					newUserCallbackURL?: string
					scopes?: string[]
					disableRedirect?: boolean
				},
				fetchOptions?: Record<string, unknown>,
			) => {
				const result = (await $fetch("/sign-in/oauth2", {
					method: "POST",
					body: {
						providerId: "telegram",
						callbackURL: options?.callbackURL,
						errorCallbackURL: options?.errorCallbackURL,
						newUserCallbackURL: options?.newUserCallbackURL,
						scopes: options?.scopes,
						disableRedirect: options?.disableRedirect,
					},
					...fetchOptions,
				})) as FetchResponse<{ redirect?: boolean; url?: string }>
				const data = result.data

				if (
					!options?.disableRedirect &&
					data?.redirect !== false &&
					typeof data?.url === "string"
				) {
					browserGlobals.window?.location?.assign(data.url)
				}

				return result
			},
			initTelegramWidget: async (
				containerId: string,
				options: TelegramLoginWidgetOptions,
				onAuth: (authData: TelegramWidgetAuthData) => void | Promise<void>,
			) => renderWidget($fetch, containerId, options, onAuth),
			initTelegramWidgetRedirect: async (
				containerId: string,
				redirectUrl: string,
				options: TelegramLoginWidgetOptions,
			) => renderWidget($fetch, containerId, options, undefined, redirectUrl),
		}),
	}) satisfies BetterAuthClientPlugin

export const createAmbyAuthClient = (
	options: Parameters<typeof createAuthClient>[0] = {},
): ReturnType<typeof createAuthClient> & TelegramAuthClientActions =>
	createAuthClient({
		...options,
		plugins: [...(options.plugins ?? []), genericOAuthClient(), telegramClient()],
	}) as ReturnType<typeof createAuthClient> & TelegramAuthClientActions
