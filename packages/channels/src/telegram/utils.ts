import {
	TELEGRAM_RELINK_REQUIRED_MESSAGE,
	TelegramIdentityService,
	type TelegramProvisionInput,
} from "@amby/auth"
import { kickOffSandboxProvisionIfNeeded, sandboxWorkflowId } from "@amby/computer/sandbox-config"
import { ComputeStore, CoreError } from "@amby/core"
import { DbService, schema } from "@amby/db"
import { EnvService, normalizeTelegramBotUsername } from "@amby/env"
import type { WorkerBindings } from "@amby/env/workers"
import {
	ConnectorsService,
	getIntegrationLabel,
	getIntegrationSuccessMessage,
	parseIntegrationStartPayload,
} from "@amby/plugins/integrations"
import { Effect } from "effect"
import { getPostHogClient } from "../posthog"
import { TelegramSender } from "./sender"

export interface TelegramFrom {
	id: number
	first_name: string
	last_name?: string
	username?: string
	language_code?: string
	is_premium?: boolean
}

export interface TelegramMessage {
	message_id: number
	text?: string
	chat: { id: number; type: string; first_name?: string; last_name?: string; username?: string }
	from?: TelegramFrom
	date: number
	entities?: unknown[]
}

export interface TelegramUpdate {
	update_id: number
	message?: TelegramMessage
}

export interface BufferedMessage {
	text: string
	messageId: number
	date: number
}

export const TELEGRAM_COMMANDS = ["/start", "/stop", "/help"] as const

export type TelegramCommandName = (typeof TELEGRAM_COMMANDS)[number]

export type ParsedTelegramCommand = {
	command: TelegramCommandName
	payload?: string
	rawText: string
}

const toTelegramProvisionInput = (from: TelegramFrom, chatId: number): TelegramProvisionInput => ({
	source: "bot",
	chatId: String(chatId),
	profile: {
		id: String(from.id),
		firstName: from.first_name,
		lastName: from.last_name ?? null,
		username: from.username ?? null,
		languageCode: from.language_code ?? null,
		isPremium: from.is_premium ?? false,
	},
})

export const resolveTelegramUser = (from: TelegramFrom, chatId: number) =>
	Effect.gen(function* () {
		const telegramIdentity = yield* TelegramIdentityService
		return yield* Effect.tryPromise(() =>
			telegramIdentity.provisionFromBot(toTelegramProvisionInput(from, chatId)),
		)
	})

/**
 * Backward-compatible wrapper that now fails when the user intentionally unlinked Telegram.
 * Callers that need to handle the blocked state gracefully should use `resolveTelegramUser()`.
 */
export const findOrCreateUser = (from: TelegramFrom, chatId: number) =>
	resolveTelegramUser(from, chatId).pipe(
		Effect.flatMap((result) =>
			result.status === "blocked"
				? Effect.fail(
						new CoreError({
							message: TELEGRAM_RELINK_REQUIRED_MESSAGE,
						}),
					)
				: Effect.succeed(result.userId),
		),
	)

const ensureTelegramConversation = (userId: string, chatId: number) =>
	Effect.gen(function* () {
		const { db } = yield* DbService

		yield* Effect.tryPromise(async () =>
			db
				.insert(schema.conversations)
				.values({
					userId,
					platform: "telegram",
					externalConversationKey: String(chatId),
				})
				.onConflictDoNothing(),
		)
	})

const startTelegramSession = (
	userId: string,
	from: TelegramFrom,
	chatId: number,
	options?: { sandboxWorkflow?: WorkerBindings["SANDBOX_WORKFLOW"] },
) =>
	Effect.gen(function* () {
		const env = yield* EnvService
		const computeStore = yield* ComputeStore
		const posthog = getPostHogClient(env.POSTHOG_KEY, env.POSTHOG_HOST)

		yield* ensureTelegramConversation(userId, chatId)

		const sandboxWorkflow = options?.sandboxWorkflow
		if (sandboxWorkflow) {
			yield* Effect.tryPromise({
				try: () =>
					kickOffSandboxProvisionIfNeeded(computeStore, userId, () =>
						sandboxWorkflow.create({
							id: sandboxWorkflowId(userId),
							params: { userId },
						}),
					),
				catch: (cause) =>
					new CoreError({
						message: `Failed to start sandbox provisioning workflow: ${cause instanceof Error ? cause.message : String(cause)}`,
					}),
			}).pipe(
				Effect.catchAll((error) =>
					Effect.sync(() => {
						console.error("[Sandbox] Provision workflow:", error)
					}),
				),
			)
		}

		posthog?.capture({
			distinctId: userId,
			event: "bot_started",
			properties: {
				channel: "telegram",
				username: from.username ?? null,
				language_code: from.language_code ?? null,
				is_premium: from.is_premium ?? false,
			},
		})
	})

const sendIntegrationStartResult = (userId: string, chatId: number, payload: string) =>
	Effect.gen(function* () {
		const sender = yield* TelegramSender
		const toolkit = parseIntegrationStartPayload(payload)

		if (!toolkit) {
			yield* Effect.tryPromise(() =>
				sender.sendMessage(
					chatId,
					"That connection link isn't recognized anymore. Just let me know which app you'd like to connect and I'll send a fresh one.",
				),
			)
			return
		}

		const connectors = yield* ConnectorsService
		const label = getIntegrationLabel(toolkit)

		if (!connectors.isEnabled()) {
			yield* Effect.tryPromise(() =>
				sender.sendMessage(
					chatId,
					`I couldn't verify ${label} because app connections aren't configured on this deployment yet.`,
				),
			)
			return
		}

		const integrations = yield* connectors.listIntegrations(userId)
		const integration = integrations.find((item) => item.toolkit === toolkit)

		if (integration?.connected) {
			yield* connectors.clearPendingIntegrationRequest(userId, toolkit)
			yield* Effect.tryPromise(() =>
				sender.sendMessage(chatId, getIntegrationSuccessMessage(toolkit)),
			)
			return
		}

		yield* Effect.tryPromise(() =>
			sender.sendMessage(
				chatId,
				`I couldn't confirm the ${label} connection yet. If you just finished authorizing it, wait a few seconds and send /start again. If you need a fresh link, ask me to connect ${label}.`,
			),
		)
	})

export const parseTelegramCommand = (
	text?: string | null,
	botUsername?: string | null,
): ParsedTelegramCommand | undefined => {
	if (!text) return undefined

	const trimmed = text.trim()
	if (!trimmed.startsWith("/")) return undefined

	const [token, ...rest] = trimmed.split(/\s+/)
	if (!token) return undefined
	const loweredToken = token.toLowerCase()
	const [command, targetBotUsername, ...extraParts] = loweredToken.split("@")

	if (!command || extraParts.length > 0) return undefined

	if (targetBotUsername) {
		const normalizedBotUsername = normalizeTelegramBotUsername(botUsername)
		if (targetBotUsername !== normalizedBotUsername) {
			return undefined
		}
	}

	if (!TELEGRAM_COMMANDS.includes(command as TelegramCommandName)) {
		return undefined
	}

	return {
		command: command as TelegramCommandName,
		payload: rest.join(" ").trim() || undefined,
		rawText: trimmed,
	}
}

export const handleCommand = (
	command: ParsedTelegramCommand,
	from: TelegramFrom,
	chatId: number,
	options?: { sandboxWorkflow?: WorkerBindings["SANDBOX_WORKFLOW"] },
) =>
	Effect.gen(function* () {
		const sender = yield* TelegramSender
		const env = yield* EnvService
		const resolvedUser = yield* resolveTelegramUser(from, chatId)
		if (resolvedUser.status === "blocked") {
			yield* Effect.tryPromise(() => sender.sendMessage(chatId, TELEGRAM_RELINK_REQUIRED_MESSAGE))
			return
		}
		const userId = resolvedUser.userId
		const posthog = getPostHogClient(env.POSTHOG_KEY, env.POSTHOG_HOST)

		switch (command.command) {
			case "/start": {
				yield* startTelegramSession(userId, from, chatId, options)

				if (command.payload) {
					yield* sendIntegrationStartResult(userId, chatId, command.payload)
					break
				}

				yield* Effect.tryPromise(() =>
					sender.sendMessage(
						chatId,
						`Welcome to Amby, ${from.first_name}! I'm your personal ambient assistant. Just send me a message and I'll help you out.`,
					),
				)
				break
			}

			case "/stop": {
				posthog?.capture({
					distinctId: userId,
					event: "bot_stopped",
					properties: { channel: "telegram" },
				})
				yield* Effect.tryPromise(() => sender.sendMessage(chatId, "Paused. Send /start to resume."))
				break
			}

			case "/help": {
				posthog?.capture({
					distinctId: userId,
					event: "help_requested",
					properties: { channel: "telegram" },
				})
				yield* Effect.tryPromise(() =>
					sender.sendMessage(
						chatId,
						"Available commands:\n/start — Start or resume the assistant\n/stop — Pause the assistant\n/help — Show this help message\n\nOr just send me any text message!",
					),
				)
				break
			}
		}
	})

export const splitTelegramMessage = (text: string, maxLength = 4096): string[] => {
	if (text.length <= maxLength) return [text]

	const chunks: string[] = []
	let remaining = text

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining)
			break
		}

		// Try to split at a newline near the limit
		let splitIndex = remaining.lastIndexOf("\n", maxLength)
		if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
			// Fall back to splitting at a space
			splitIndex = remaining.lastIndexOf(" ", maxLength)
		}
		if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
			// Hard split at the limit
			splitIndex = maxLength
		}

		chunks.push(remaining.slice(0, splitIndex))
		remaining = remaining.slice(splitIndex).trimStart()
	}

	return chunks
}
