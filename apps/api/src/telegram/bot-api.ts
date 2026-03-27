import { renderTelegramMessageChunks } from "./formatting"
import type { TelegramCommandName } from "./utils"

const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org"

type TelegramBotApiResponse<T> = {
	ok: boolean
	description?: string
	result: T
}

type TelegramSentMessage = {
	message_id: number
}

export interface TelegramBotApiClient {
	sendMessage(chatId: number, text: string): Promise<TelegramSentMessage[]>
	startTyping(chatId: number): Promise<void>
	deleteMessage(chatId: number, messageId: number): Promise<void>
	setMyCommands(
		commands: Array<{
			command: TelegramCommandName extends `/${infer Name}` ? Name : never
			description: string
		}>,
	): Promise<void>
}

export function createTelegramBotApiClient(config: {
	botToken: string
	apiBaseUrl?: string
}): TelegramBotApiClient {
	const baseUrl = `${(config.apiBaseUrl ?? DEFAULT_TELEGRAM_API_BASE_URL).replace(/\/+$/, "")}/bot${config.botToken}`

	const request = async <T>(method: string, body?: Record<string, unknown>): Promise<T> => {
		const response = await fetch(`${baseUrl}/${method}`, {
			method: body ? "POST" : "GET",
			headers: body ? { "Content-Type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		})
		const data = (await response.json()) as TelegramBotApiResponse<T>

		if (!response.ok || !data.ok) {
			throw new Error(data.description ?? `Telegram API ${method} failed`)
		}

		return data.result
	}

	return {
		sendMessage: async (chatId, text) => {
			const chunks = renderTelegramMessageChunks(text)
			const sent: TelegramSentMessage[] = []

			for (const chunk of chunks) {
				if (!chunk.plainText.trim()) continue
				const result = await request<TelegramSentMessage>("sendMessage", {
					chat_id: chatId,
					text: chunk.html,
					parse_mode: "HTML",
				})
				sent.push(result)
			}

			return sent
		},
		startTyping: async (chatId) => {
			await request("sendChatAction", {
				chat_id: chatId,
				action: "typing",
			})
		},
		deleteMessage: async (chatId, messageId) => {
			await request("deleteMessage", {
				chat_id: chatId,
				message_id: messageId,
			})
		},
		setMyCommands: async (commands) => {
			await request("setMyCommands", { commands })
		},
	}
}
