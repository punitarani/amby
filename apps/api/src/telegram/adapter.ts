import {
	createTelegramAdapter as createBaseTelegramAdapter,
	type TelegramAdapter,
	type TelegramAdapterConfig,
	type TelegramRawMessage,
	type TelegramThreadId,
} from "@chat-adapter/telegram"
import type { Message, RawMessage } from "chat"
import {
	getTelegramRichTextHtml,
	isTelegramRichTextMessage,
	TELEGRAM_HTML_PARSE_MODE,
} from "./html-format"

type TelegramAdapterInternals = {
	cacheMessage(message: Message<TelegramRawMessage>): void
	decodeCompositeMessageId(
		messageId: string,
		fallbackChatId: string,
	): { chatId: string; compositeId: string; messageId: number }
	encodeThreadId(platformData: TelegramThreadId): string
	findCachedMessage(messageId: string): Message<TelegramRawMessage> | undefined
	parseTelegramMessage(raw: TelegramRawMessage, threadId: string): Message<TelegramRawMessage>
	resolveThreadId(threadId: string): TelegramThreadId
	telegramFetch<T>(method: string, body?: Record<string, unknown>): Promise<T>
}

function toInternalAdapter(adapter: TelegramAdapter): TelegramAdapterInternals {
	return adapter as unknown as TelegramAdapterInternals
}

async function postTelegramRichText(
	adapter: TelegramAdapterInternals,
	threadId: string,
	html: string,
): Promise<RawMessage<TelegramRawMessage>> {
	const parsedThread = adapter.resolveThreadId(threadId)
	const rawMessage = await adapter.telegramFetch<TelegramRawMessage>("sendMessage", {
		chat_id: parsedThread.chatId,
		message_thread_id: parsedThread.messageThreadId,
		text: html,
		parse_mode: TELEGRAM_HTML_PARSE_MODE,
	})
	const resultingThreadId = adapter.encodeThreadId({
		chatId: String(rawMessage.chat.id),
		messageThreadId: rawMessage.message_thread_id ?? parsedThread.messageThreadId,
	})
	const parsedMessage = adapter.parseTelegramMessage(rawMessage, resultingThreadId)
	adapter.cacheMessage(parsedMessage)
	return {
		id: parsedMessage.id,
		threadId: parsedMessage.threadId,
		raw: rawMessage,
	}
}

async function editTelegramRichText(
	adapter: TelegramAdapterInternals,
	threadId: string,
	messageId: string,
	html: string,
): Promise<RawMessage<TelegramRawMessage>> {
	const parsedThread = adapter.resolveThreadId(threadId)
	const {
		chatId,
		compositeId,
		messageId: telegramMessageId,
	} = adapter.decodeCompositeMessageId(messageId, parsedThread.chatId)
	const result = await adapter.telegramFetch<TelegramRawMessage | true>("editMessageText", {
		chat_id: chatId,
		message_id: telegramMessageId,
		text: html,
		parse_mode: TELEGRAM_HTML_PARSE_MODE,
	})

	if (result === true) {
		const cachedMessage = adapter.findCachedMessage(compositeId)
		if (!cachedMessage) {
			throw new Error(
				`Telegram editMessageText returned true without cached message ${compositeId}`,
			)
		}
		return {
			id: cachedMessage.id,
			threadId: cachedMessage.threadId,
			raw: cachedMessage.raw,
		}
	}

	const resultingThreadId = adapter.encodeThreadId({
		chatId: String(result.chat.id),
		messageThreadId: result.message_thread_id ?? parsedThread.messageThreadId,
	})
	const parsedMessage = adapter.parseTelegramMessage(result, resultingThreadId)
	adapter.cacheMessage(parsedMessage)
	return {
		id: parsedMessage.id,
		threadId: parsedMessage.threadId,
		raw: result,
	}
}

export function createTelegramAdapter(config?: TelegramAdapterConfig): TelegramAdapter {
	const adapter = createBaseTelegramAdapter(config)
	const internal = toInternalAdapter(adapter)
	const postMessage = adapter.postMessage.bind(adapter)
	const editMessage = adapter.editMessage.bind(adapter)

	adapter.postMessage = (threadId, message) => {
		if (!isTelegramRichTextMessage(message)) {
			return postMessage(threadId, message)
		}

		return postTelegramRichText(internal, threadId, getTelegramRichTextHtml(message))
	}

	adapter.editMessage = (threadId, messageId, message) => {
		if (!isTelegramRichTextMessage(message)) {
			return editMessage(threadId, messageId, message)
		}

		return editTelegramRichText(internal, threadId, messageId, getTelegramRichTextHtml(message))
	}

	return adapter
}
