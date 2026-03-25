import type { StoredMessage, RequestLogEntry } from "./telegram-types"

interface MessageStore {
	messages: Map<number, StoredMessage>
	requestLog: RequestLogEntry[]
	nextMessageId: number
}

const MAX_LOG_ENTRIES = 100

function createStore(): MessageStore {
	return {
		messages: new Map(),
		requestLog: [],
		nextMessageId: 1000,
	}
}

// Persist across HMR in development
const globalStore = globalThis as unknown as { __mockChannelStore?: MessageStore }

export function getStore(): MessageStore {
	if (!globalStore.__mockChannelStore) {
		globalStore.__mockChannelStore = createStore()
	}
	return globalStore.__mockChannelStore
}

export function addMessage(msg: Omit<StoredMessage, "message_id">): StoredMessage {
	const store = getStore()
	const message_id = store.nextMessageId++
	const stored: StoredMessage = { ...msg, message_id }
	store.messages.set(message_id, stored)
	return stored
}

export function editMessage(messageId: number, text: string): StoredMessage | null {
	const store = getStore()
	const msg = store.messages.get(messageId)
	if (!msg) return null
	msg.text = text
	msg.edited = true
	return msg
}

export function deleteMessage(messageId: number): boolean {
	const store = getStore()
	const msg = store.messages.get(messageId)
	if (!msg) return false
	msg.deleted = true
	return true
}

export function getMessages(): StoredMessage[] {
	const store = getStore()
	return [...store.messages.values()].filter((m) => !m.deleted)
}

export function addLogEntry(entry: Omit<RequestLogEntry, "id" | "timestamp">): RequestLogEntry {
	const store = getStore()
	const logged: RequestLogEntry = {
		...entry,
		id: crypto.randomUUID(),
		timestamp: Date.now(),
	}
	store.requestLog.push(logged)
	if (store.requestLog.length > MAX_LOG_ENTRIES) {
		store.requestLog = store.requestLog.slice(-MAX_LOG_ENTRIES)
	}
	return logged
}

export function getRequestLog(): RequestLogEntry[] {
	return getStore().requestLog
}

export function clearStore(): void {
	const store = getStore()
	store.messages.clear()
	store.requestLog = []
	store.nextMessageId = 1000
}
