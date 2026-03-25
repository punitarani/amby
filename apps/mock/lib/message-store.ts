import type { DisplayMessage, RequestLogEntry } from "./telegram-types"

/** Server-side only — survives across API calls but not server restarts. */

let messages: DisplayMessage[] = []
let requestLog: RequestLogEntry[] = []
let nextMessageId = 1

export function getMessages(): DisplayMessage[] {
	return messages
}

export function addMessage(role: "user" | "bot", text: string): DisplayMessage {
	const msg: DisplayMessage = {
		id: String(nextMessageId++),
		role,
		text,
		timestamp: Date.now(),
	}
	messages.push(msg)
	return msg
}

export function clearMessages(): void {
	messages = []
	nextMessageId = 1
}

export function getRequestLog(): RequestLogEntry[] {
	return requestLog
}

export function addRequestLogEntry(entry: Omit<RequestLogEntry, "id" | "timestamp">): RequestLogEntry {
	const full: RequestLogEntry = {
		...entry,
		id: crypto.randomUUID(),
		timestamp: Date.now(),
	}
	requestLog.push(full)
	// Keep only last 100 entries
	if (requestLog.length > 100) {
		requestLog = requestLog.slice(-100)
	}
	return full
}

export function clearRequestLog(): void {
	requestLog = []
}
