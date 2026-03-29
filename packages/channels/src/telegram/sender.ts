import { AttachmentService } from "@amby/attachments"
import type { ConversationMessagePart, ReplySenderService, ReplyTarget } from "@amby/core"
import { ReplySender } from "@amby/core"
import { EnvService } from "@amby/env"
import { Context, Effect, Layer, Runtime } from "effect"
import { splitTelegramMessage } from "./utils"

// --- TelegramSender Effect Service ---

export class TelegramSender extends Context.Tag("TelegramSender")<
	TelegramSender,
	{
		sendMessage(chatId: number, text: string): Promise<void>
		startTyping(chatId: number): Promise<void>
	}
>() {}

type TelegramApiResponse<T> = {
	ok?: boolean
	result?: T
	description?: string
}

function makeTelegramApi(env: { TELEGRAM_BOT_TOKEN: string; TELEGRAM_API_BASE_URL?: string }) {
	const baseUrl = env.TELEGRAM_API_BASE_URL || "https://api.telegram.org"
	const endpoint = (method: string) => `${baseUrl}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`
	const request = async <T>(
		method: string,
		options: { json?: Record<string, unknown>; formData?: FormData },
	): Promise<T> => {
		const response = await fetch(endpoint(method), {
			method: "POST",
			headers: options.formData ? undefined : { "Content-Type": "application/json" },
			body: options.formData ? options.formData : JSON.stringify(options.json ?? {}),
		})
		if (!response.ok) {
			throw new Error(`Telegram ${method} failed with ${response.status}`)
		}
		const json = (await response.json()) as TelegramApiResponse<T>
		if (!json.ok || json.result === undefined) {
			throw new Error(json.description || `Telegram ${method} returned an invalid response`)
		}
		return json.result
	}

	return {
		sendMessage: async (chatId: number, text: string) =>
			await request<{ message_id: number }>("sendMessage", {
				json: { chat_id: chatId, text },
			}),
		sendChatAction: async (chatId: number, action: string) =>
			await request("sendChatAction", { json: { chat_id: chatId, action } }),
		sendPhoto: async (chatId: number, body: ArrayBuffer, filename: string) => {
			const formData = new FormData()
			formData.set("chat_id", String(chatId))
			formData.set("photo", new Blob([body]), filename)
			return await request<{ message_id: number }>("sendPhoto", { formData })
		},
		sendDocument: async (chatId: number, body: ArrayBuffer, filename: string) => {
			const formData = new FormData()
			formData.set("chat_id", String(chatId))
			formData.set("document", new Blob([body]), filename)
			return await request<{ message_id: number }>("sendDocument", { formData })
		},
	}
}

function buildTelegramSenderService(env: {
	TELEGRAM_BOT_TOKEN: string
	TELEGRAM_API_BASE_URL?: string
}) {
	const api = makeTelegramApi(env)
	return {
		sendMessage: async (chatId: number, text: string) => {
			for (const chunk of splitTelegramMessage(text)) {
				await api.sendMessage(chatId, chunk)
			}
		},
		startTyping: async (chatId: number) => {
			await api.sendChatAction(chatId, "typing")
		},
	}
}

export const TelegramSenderLive = Layer.effect(
	TelegramSender,
	Effect.gen(function* () {
		const env = yield* EnvService
		if (!env.TELEGRAM_BOT_TOKEN) {
			throw new Error("TELEGRAM_BOT_TOKEN is not set")
		}

		yield* Effect.tryPromise(() =>
			fetch(
				`${env.TELEGRAM_API_BASE_URL || "https://api.telegram.org"}/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						commands: [
							{ command: "start", description: "Start or resume the assistant" },
							{ command: "stop", description: "Pause the assistant" },
							{ command: "help", description: "Show help" },
						],
					}),
				},
			),
		)

		return buildTelegramSenderService(env)
	}),
)

/** Lightweight TelegramSender layer that skips setMyCommands — suitable for per-request use in Workers */
export const TelegramSenderLite = Layer.effect(
	TelegramSender,
	Effect.gen(function* () {
		const env = yield* EnvService
		if (!env.TELEGRAM_BOT_TOKEN) {
			throw new Error("TELEGRAM_BOT_TOKEN is not set")
		}
		return buildTelegramSenderService(env)
	}),
)

export const TelegramReplySenderLive = Layer.effect(
	ReplySender,
	Effect.gen(function* () {
		const env = yield* EnvService
		const attachments = yield* AttachmentService
		const rt = yield* Effect.runtime<never>()
		const runPromise = Runtime.runPromise(rt)
		if (!env.TELEGRAM_BOT_TOKEN) {
			throw new Error("TELEGRAM_BOT_TOKEN is not set")
		}
		const api = makeTelegramApi(env)
		const sender: ReplySenderService = {
			startTyping: (target: ReplyTarget) =>
				Promise.resolve(
					target.channel === "telegram" ? api.sendChatAction(target.chatId, "typing") : undefined,
				).then(() => undefined),
			postText: async (target: ReplyTarget, text: string) => {
				if (target.channel !== "telegram") return
				for (const chunk of splitTelegramMessage(text)) {
					await api.sendMessage(target.chatId, chunk)
				}
			},
			sendParts: async (target: ReplyTarget, parts: ReadonlyArray<ConversationMessagePart>) => {
				if (target.channel !== "telegram") return
				for (const part of parts) {
					if (part.type === "text") {
						for (const chunk of splitTelegramMessage(part.text)) {
							await api.sendMessage(target.chatId, chunk)
						}
						continue
					}

					const attachment = part.attachment
					if (!attachment.id) continue
					const filename = attachment.filename || attachment.title || `${attachment.id}.bin`

					try {
						let delivered = false
						try {
							const { body, record } = await runPromise(
								attachments.loadAttachmentContent(attachment.id),
							)
							if (
								record.kind === "image" &&
								(record.sizeBytes ?? body.byteLength) <= 20 * 1024 * 1024
							) {
								await api.sendPhoto(target.chatId, body, filename)
								delivered = true
							} else if ((record.sizeBytes ?? body.byteLength) <= 20 * 1024 * 1024) {
								await api.sendDocument(target.chatId, body, filename)
								delivered = true
							}
						} catch {
							// Fall through to signed-link delivery.
						}

						if (!delivered) {
							const url = await runPromise(attachments.buildSignedDownloadUrl(attachment.id))
							const label = attachment.title || attachment.filename || "attachment"
							await api.sendMessage(target.chatId, `Download ${label}: ${url}`)
						}
					} catch (err) {
						console.error(`[sender] Failed to deliver attachment ${attachment.id}:`, err)
					}
				}
			},
		}
		return sender
	}),
)
