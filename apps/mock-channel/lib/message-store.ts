import type { RequestLogEntry, StoredMessage } from "./telegram-types"

let nextMessageId = 1

const messages: StoredMessage[] = []
const requestLog: RequestLogEntry[] = []

export function addMessage(params: {
	chat_id: number
	text: string
	from_bot: boolean
	date: number
}): StoredMessage {
	const msg: StoredMessage = {
		message_id: nextMessageId++,
		chat_id: params.chat_id,
		text: params.text,
		from_bot: params.from_bot,
		date: params.date,
	}
	messages.push(msg)
	return msg
}

export function addLogEntry(params: {
	direction: "inbound" | "outbound"
	method: string
	url: string
	body: unknown
}): RequestLogEntry {
	const entry: RequestLogEntry = {
		id: crypto.randomUUID(),
		timestamp: Date.now(),
		direction: params.direction,
		method: params.method,
		url: params.url,
		body: params.body,
	}
	requestLog.push(entry)
	return entry
}

export function getMessages(): StoredMessage[] {
	return [...messages]
}

export function getRequestLog(): RequestLogEntry[] {
	return [...requestLog]
}

export function getStore() {
	return {
		messages: getMessages(),
		requestLog: getRequestLog(),
	}
}

export function clearStore(): void {
	messages.length = 0
	requestLog.length = 0
}
