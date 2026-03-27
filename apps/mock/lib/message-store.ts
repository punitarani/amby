import type { DisplayMessage, RequestLogEntry } from "./telegram-types"

/** Server-side only — survives across API calls but not server restarts. */

let messages: DisplayMessage[] = []
let requestLog: RequestLogEntry[] = []
let nextMessageId = 1

export function getMessages(): DisplayMessage[] {
	return messages
}

export function addMessage(role: "user" | "bot", text: string, parseMode?: string): DisplayMessage {
	const msg: DisplayMessage = {
		id: String(nextMessageId++),
		role,
		text,
		parseMode,
		timestamp: Date.now(),
	}
	messages.push(msg)
	return msg
}

export function updateMessage(
	id: string,
	updates: Partial<Pick<DisplayMessage, "text" | "parseMode">>,
): DisplayMessage | undefined {
	const index = messages.findIndex((message) => message.id === id)
	if (index === -1) return undefined
	const current = messages[index]
	if (!current) return undefined

	const next: DisplayMessage = {
		...current,
		...updates,
	}
	messages[index] = next
	return next
}

export function clearMessages(): void {
	messages = []
	nextMessageId = 1
}

export function getRequestLog(): RequestLogEntry[] {
	return requestLog
}

export function addRequestLogEntry(
	entry: Omit<RequestLogEntry, "id" | "timestamp">,
): RequestLogEntry {
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
