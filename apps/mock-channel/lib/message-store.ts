import type { StoredMessage, RequestLogEntry, MessageStore } from "./telegram-types"

declare const globalThis: {
	__mockChannelStore?: MessageStore
}

function getStore(): MessageStore {
	if (!globalThis.__mockChannelStore) {
		globalThis.__mockChannelStore = {
			messages: [],
			log: [],
			nextMessageId: 1,
			nextLogId: 1,
		}
	}
	return globalThis.__mockChannelStore
}

export function addMessage(
	input: Omit<StoredMessage, "message_id">,
): StoredMessage {
	const store = getStore()
	const msg: StoredMessage = {
		...input,
		message_id: store.nextMessageId++,
	}
	store.messages.push(msg)
	return msg
}

export function editMessage(
	messageId: number,
	text: string,
): StoredMessage | null {
	const store = getStore()
	const msg = store.messages.find((m) => m.message_id === messageId)
	if (!msg) return null
	msg.text = text
	msg.edit_date = Math.floor(Date.now() / 1000)
	return msg
}

export function deleteMessage(messageId: number): boolean {
	const store = getStore()
	const index = store.messages.findIndex((m) => m.message_id === messageId)
	if (index === -1) return false
	store.messages.splice(index, 1)
	return true
}

export function addLogEntry(
	input: Omit<RequestLogEntry, "id" | "timestamp">,
): RequestLogEntry {
	const store = getStore()
	const entry: RequestLogEntry = {
		...input,
		id: store.nextLogId++,
		timestamp: Date.now(),
	}
	store.log.push(entry)
	return entry
}

export function getMessages(): StoredMessage[] {
	return getStore().messages
}

export function getLog(): RequestLogEntry[] {
	return getStore().log
}

export function clearStore(): void {
	const store = getStore()
	store.messages = []
	store.log = []
	store.nextMessageId = 1
	store.nextLogId = 1
}
