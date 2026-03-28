import { kickOffSandboxProvisionIfNeeded, sandboxWorkflowId } from "@amby/computer/sandbox-config"
import type {
	AttachmentKind,
	BufferedAttachmentPart,
	BufferedInboundMessage,
	BufferedMessagePart,
} from "@amby/core"
import { ComputeStore, CoreError } from "@amby/core"
import { and, DbService, eq, schema } from "@amby/db"
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

// --- Types ---

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
	caption?: string
	chat: { id: number; type: string; first_name?: string; last_name?: string; username?: string }
	from?: TelegramFrom
	date: number
	entities?: unknown[]
	media_group_id?: string
	photo?: TelegramPhotoSize[]
	document?: TelegramDocument
}

export interface TelegramPhotoSize {
	file_id: string
	file_unique_id?: string
	width: number
	height: number
	file_size?: number
}

export interface TelegramDocument {
	file_id: string
	file_unique_id?: string
	file_name?: string
	mime_type?: string
	file_size?: number
}

export interface TelegramUpdate {
	update_id: number
	message?: TelegramMessage
}

export interface TelegramQueueMessage {
	update: TelegramUpdate
	receivedAt: number
}

export type BufferedMessage = BufferedInboundMessage

export const TELEGRAM_COMMANDS = ["/start", "/stop", "/help"] as const

export type TelegramCommandName = (typeof TELEGRAM_COMMANDS)[number]

export type ParsedTelegramCommand = {
	command: TelegramCommandName
	payload?: string
	rawText: string
}

function getFilenameExtension(filename?: string | null): string | null {
	if (!filename) return null
	const trimmed = filename.trim()
	const dotIndex = trimmed.lastIndexOf(".")
	if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return null
	return trimmed.slice(dotIndex + 1).toLowerCase()
}

function inferBufferedAttachmentKind(params: {
	mediaType?: string | null
	filename?: string | null
}): AttachmentKind {
	const mediaType = params.mediaType?.trim().toLowerCase() ?? ""
	const ext = getFilenameExtension(params.filename)
	if (mediaType.startsWith("image/")) return "image"
	if (mediaType === "application/pdf" || ext === "pdf") return "pdf"
	if (
		mediaType === "text/plain" ||
		mediaType === "text/markdown" ||
		mediaType === "text/csv" ||
		mediaType === "application/json" ||
		ext === "txt" ||
		ext === "md" ||
		ext === "markdown" ||
		ext === "csv" ||
		ext === "json"
	) {
		return "text"
	}
	return mediaType ? "document" : "binary"
}

function summarizeBufferedAttachments(parts: ReadonlyArray<BufferedAttachmentPart>): string {
	if (parts.length === 0) return ""
	const counts = new Map<AttachmentKind, number>()
	for (const part of parts) {
		counts.set(part.attachment.kind, (counts.get(part.attachment.kind) ?? 0) + 1)
	}
	const labels = (
		[
			["image", "image"],
			["pdf", "PDF"],
			["text", "text document"],
			["document", "document"],
			["binary", "file"],
		] as const
	)
		.flatMap(([kind, label]) => {
			const count = counts.get(kind)
			return count ? `${count} ${label}${count === 1 ? "" : "s"}` : []
		})
		.slice(0, 3)
	if (labels.length === 0) return "User sent attachments."
	if (labels.length === 1) return `User sent ${labels[0]}.`
	if (labels.length === 2) return `User sent ${labels[0]} and ${labels[1]}.`
	return `User sent ${labels[0]}, ${labels[1]}, and ${labels[2]}.`
}

function buildBufferedAttachmentPartFromPhoto(
	message: TelegramMessage,
): BufferedAttachmentPart | null {
	const variants = message.photo ?? []
	if (variants.length === 0) return null
	const photo = [...variants].sort((left, right) => {
		const leftScore = left.file_size ?? left.width * left.height
		const rightScore = right.file_size ?? right.width * right.height
		return rightScore - leftScore
	})[0]
	if (!photo) return null
	return {
		type: "attachment",
		attachment: {
			kind: "image",
			mediaType: "image/jpeg",
			sizeBytes: photo.file_size ?? null,
			title: "Telegram photo",
			metadata: {
				width: photo.width,
				height: photo.height,
			},
			source: {
				kind: "telegram",
				telegramType: "photo",
				fileId: photo.file_id,
				fileUniqueId: photo.file_unique_id ?? null,
				chatId: message.chat.id,
				sourceMessageId: message.message_id,
				mediaGroupId: message.media_group_id ?? null,
				mediaType: "image/jpeg",
				sizeBytes: photo.file_size ?? null,
			},
		},
	}
}

function buildBufferedAttachmentPartFromDocument(
	message: TelegramMessage,
): BufferedAttachmentPart | null {
	const document = message.document
	if (!document) return null
	const kind = inferBufferedAttachmentKind({
		mediaType: document.mime_type,
		filename: document.file_name,
	})
	return {
		type: "attachment",
		attachment: {
			kind,
			mediaType: document.mime_type ?? null,
			filename: document.file_name ?? null,
			sizeBytes: document.file_size ?? null,
			title: document.file_name ?? "Telegram file",
			source: {
				kind: "telegram",
				telegramType: "document",
				fileId: document.file_id,
				fileUniqueId: document.file_unique_id ?? null,
				chatId: message.chat.id,
				sourceMessageId: message.message_id,
				mediaGroupId: message.media_group_id ?? null,
				mediaType: document.mime_type ?? null,
				filename: document.file_name ?? null,
				sizeBytes: document.file_size ?? null,
			},
		},
	}
}

export function buildBufferedTelegramMessage(
	message: TelegramMessage,
): BufferedInboundMessage | null {
	const parts: BufferedMessagePart[] = []
	const text = (message.text ?? message.caption ?? "").trim()
	if (text) {
		parts.push({ type: "text", text })
	}
	const photoPart = buildBufferedAttachmentPartFromPhoto(message)
	if (photoPart) parts.push(photoPart)
	const documentPart = buildBufferedAttachmentPartFromDocument(message)
	if (documentPart) parts.push(documentPart)
	if (parts.length === 0) return null

	const attachmentParts = parts.filter(
		(part): part is BufferedAttachmentPart => part.type === "attachment",
	)
	const textSummary = text || summarizeBufferedAttachments(attachmentParts)

	return {
		sourceMessageId: message.message_id,
		date: message.date,
		textSummary,
		parts,
		mediaGroupId: message.media_group_id ?? null,
		from: message.from ? { ...message.from } : null,
		rawSource: {
			platform: "telegram",
			messageIds: [message.message_id],
		},
	}
}

/**
 * Best-effort timezone inference from Telegram's language_code.
 * Returns an IANA timezone or undefined if no confident mapping exists.
 * This is a rough heuristic — the system prompt will ask users on UTC to confirm.
 */
const inferTimezoneFromLanguageCode = (code?: string): string | undefined => {
	if (!code) return undefined
	const map: Record<string, string> = {
		"en-US": "America/New_York",
		"en-GB": "Europe/London",
		"en-AU": "Australia/Sydney",
		de: "Europe/Berlin",
		fr: "Europe/Paris",
		es: "Europe/Madrid",
		it: "Europe/Rome",
		pt: "America/Sao_Paulo",
		"pt-BR": "America/Sao_Paulo",
		ru: "Europe/Moscow",
		ja: "Asia/Tokyo",
		ko: "Asia/Seoul",
		zh: "Asia/Shanghai",
		"zh-TW": "Asia/Taipei",
		ar: "Asia/Riyadh",
		hi: "Asia/Kolkata",
		tr: "Europe/Istanbul",
		pl: "Europe/Warsaw",
		nl: "Europe/Amsterdam",
		uk: "Europe/Kyiv",
		th: "Asia/Bangkok",
		vi: "Asia/Ho_Chi_Minh",
		id: "Asia/Jakarta",
		sv: "Europe/Stockholm",
		da: "Europe/Copenhagen",
		fi: "Europe/Helsinki",
		nb: "Europe/Oslo",
		he: "Asia/Jerusalem",
	}
	const base = code.split("-")[0]
	return map[code] ?? (base ? map[base] : undefined)
}

// --- Utilities ---

export const buildProfileMetadata = (
	from: TelegramFrom,
	chatId: number,
): Record<string, unknown> => ({
	chatId,
	username: from.username ?? null,
	firstName: from.first_name,
	lastName: from.last_name ?? null,
	languageCode: from.language_code ?? null,
	isPremium: from.is_premium ?? false,
})

/**
 * Find or create a user linked to a Telegram account.
 * Uses a transaction to avoid race conditions on concurrent messages.
 * Stores/updates profile metadata on the account row.
 */
export const findOrCreateUser = (from: TelegramFrom, chatId: number) =>
	Effect.gen(function* () {
		const { db } = yield* DbService
		const metadata = buildProfileMetadata(from, chatId)

		return yield* Effect.tryPromise(async () => {
			// Fast path: check if the account already exists (no transaction needed)
			const existing = await db
				.select({ userId: schema.accounts.userId, id: schema.accounts.id })
				.from(schema.accounts)
				.where(
					and(
						eq(schema.accounts.providerId, "telegram"),
						eq(schema.accounts.accountId, String(from.id)),
					),
				)
				.limit(1)

			if (existing[0]) {
				await db
					.update(schema.accounts)
					.set({ metadata, updatedAt: new Date() })
					.where(eq(schema.accounts.id, existing[0].id))
				return existing[0].userId
			}

			// Slow path: create user + account in a transaction
			try {
				return await db.transaction(async (tx) => {
					// Re-check inside transaction to handle concurrent creation
					const recheck = await tx
						.select({ userId: schema.accounts.userId })
						.from(schema.accounts)
						.where(
							and(
								eq(schema.accounts.providerId, "telegram"),
								eq(schema.accounts.accountId, String(from.id)),
							),
						)
						.limit(1)

					if (recheck[0]) {
						return recheck[0].userId
					}

					const userId = crypto.randomUUID()
					const name = [from.first_name, from.last_name].filter(Boolean).join(" ")
					const inferredTz = inferTimezoneFromLanguageCode(from.language_code)

					await tx.insert(schema.users).values({
						id: userId,
						name,
						...(inferredTz ? { timezone: inferredTz } : {}),
					})
					await tx.insert(schema.accounts).values({
						id: crypto.randomUUID(),
						userId,
						accountId: String(from.id),
						providerId: "telegram",
						metadata,
					})

					return userId
				})
			} catch (err) {
				// Race condition: another request created the account between our check and insert.
				// Retry the lookup — the account should now exist.
				const retryLookup = await db
					.select({ userId: schema.accounts.userId })
					.from(schema.accounts)
					.where(
						and(
							eq(schema.accounts.providerId, "telegram"),
							eq(schema.accounts.accountId, String(from.id)),
						),
					)
					.limit(1)

				if (retryLookup[0]) {
					return retryLookup[0].userId
				}

				// If still not found, the error is genuine — rethrow
				throw err
			}
		})
	})

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

		posthog.capture({
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

/**
 * Handle simple stateless commands (/start, /stop, /help) inline.
 * Returns an Effect that sends the appropriate response via the Telegram Bot API.
 */
export const handleCommand = (
	command: ParsedTelegramCommand,
	from: TelegramFrom,
	chatId: number,
	options?: { sandboxWorkflow?: WorkerBindings["SANDBOX_WORKFLOW"] },
) =>
	Effect.gen(function* () {
		const sender = yield* TelegramSender
		const env = yield* EnvService
		const userId = yield* findOrCreateUser(from, chatId)
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
				posthog.capture({
					distinctId: userId,
					event: "bot_stopped",
					properties: { channel: "telegram" },
				})
				yield* Effect.tryPromise(() => sender.sendMessage(chatId, "Paused. Send /start to resume."))
				break
			}

			case "/help": {
				posthog.capture({
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

/** Split a long message into chunks that fit within Telegram's 4096-char limit. */
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
