import { AttachmentService } from "@amby/attachments"
import type {
	ConversationMessagePart,
	ReplyDraftHandle,
	ReplySenderService,
	ReplyTarget,
} from "@amby/core"
import { ReplySender } from "@amby/core"
import { EnvService } from "@amby/env"
import { Context, Effect, Layer, Runtime } from "effect"

// --- TelegramSender Effect Service ---

export class TelegramSender extends Context.Tag("TelegramSender")<
	TelegramSender,
	{
		sendMessage(chatId: number, text: string): Promise<void>
		startTyping(chatId: number): Promise<void>
		editMessage(chatId: number, messageId: string, text: string): Promise<void>
		deleteMessage(chatId: number, messageId: string): Promise<void>
	}
>() {}

type TelegramApiResponse<T> = {
	ok?: boolean
	result?: T
	description?: string
}

function splitTelegramText(text: string, maxLength = 4096): string[] {
	if (text.length <= maxLength) return [text]
	const chunks: string[] = []
	let remaining = text
	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining)
			break
		}
		let splitIndex = remaining.lastIndexOf("\n", maxLength)
		if (splitIndex < Math.floor(maxLength * 0.5)) {
			splitIndex = remaining.lastIndexOf(" ", maxLength)
		}
		if (splitIndex < Math.floor(maxLength * 0.5)) {
			splitIndex = maxLength
		}
		chunks.push(remaining.slice(0, splitIndex))
		remaining = remaining.slice(splitIndex).trimStart()
	}
	return chunks
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
		editMessageText: async (chatId: number, messageId: string, text: string) =>
			await request("editMessageText", {
				json: { chat_id: chatId, message_id: Number(messageId), text },
			}),
		deleteMessage: async (chatId: number, messageId: string) =>
			await request("deleteMessage", {
				json: { chat_id: chatId, message_id: Number(messageId) },
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
			for (const chunk of splitTelegramText(text)) {
				await api.sendMessage(chatId, chunk)
			}
		},
		startTyping: async (chatId: number) => {
			await api.sendChatAction(chatId, "typing")
		},
		editMessage: async (chatId: number, messageId: string, text: string) => {
			await api.editMessageText(chatId, messageId, text)
		},
		deleteMessage: async (chatId: number, messageId: string) => {
			await api.deleteMessage(chatId, messageId)
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
			postText: async (target: ReplyTarget, text: string): Promise<ReplyDraftHandle> => {
				if (target.channel !== "telegram") return { id: crypto.randomUUID() }
				let lastMessageId: string | null = null
				for (const chunk of splitTelegramText(text)) {
					const result = await api.sendMessage(target.chatId, chunk)
					lastMessageId = String(result.message_id)
				}
				return { id: lastMessageId ?? crypto.randomUUID() }
			},
			editText: async (target: ReplyTarget, draft: ReplyDraftHandle, text: string) => {
				if (target.channel !== "telegram") return
				await api.editMessageText(target.chatId, draft.id, text)
			},
			deleteMessage: async (target: ReplyTarget, draft: ReplyDraftHandle) => {
				if (target.channel !== "telegram") return
				await api.deleteMessage(target.chatId, draft.id)
			},
			sendParts: async (target: ReplyTarget, parts: ReadonlyArray<ConversationMessagePart>) => {
				if (target.channel !== "telegram") return
				for (const part of parts) {
					if (part.type === "text") {
						for (const chunk of splitTelegramText(part.text)) {
							await api.sendMessage(target.chatId, chunk)
						}
						continue
					}

					const attachment = part.attachment
					if (!attachment.id) continue
					const filename = attachment.filename || attachment.title || `${attachment.id}.bin`

					try {
						const { body, record } = await runPromise(
							attachments.loadAttachmentContent(attachment.id),
						)
						if (
							record.kind === "image" &&
							(record.sizeBytes ?? body.byteLength) <= 20 * 1024 * 1024
						) {
							await api.sendPhoto(target.chatId, body, filename)
							continue
						}
						if ((record.sizeBytes ?? body.byteLength) <= 20 * 1024 * 1024) {
							await api.sendDocument(target.chatId, body, filename)
							continue
						}
					} catch {
						// Fall through to signed-link delivery.
					}

					const url = await runPromise(attachments.buildSignedDownloadUrl(attachment.id))
					const label = attachment.title || attachment.filename || "attachment"
					await api.sendMessage(target.chatId, `Download ${label}: ${url}`)
				}
			},
		}
		return sender
	}),
)
