/**
 * Pure, testable logic for the ConversationSession DO.
 * Separated from the DO class to avoid cloudflare:workers import in tests.
 */

import type { BufferedMessage } from "@amby/channels"

export const DEBOUNCE_BASE_MS = 800
export const DEBOUNCE_EXTEND_MS = 400
export const DEBOUNCE_CAP_MS = 1500
export const RERUN_DEBOUNCE_MS = 250

const CORRECTION_PREFIXES = [
	"wait",
	"actually",
	"sorry",
	"i meant",
	"ignore that",
	"correction",
	"to clarify",
	"instead",
] as const

export function isCorrectionMessage(message: BufferedMessage): boolean {
	const text = message.textSummary?.trim().toLowerCase() ?? ""
	if (!text) return false
	return CORRECTION_PREFIXES.some((prefix) => text.startsWith(prefix))
}

export function computeDebounceDeadline(
	now: number,
	bufferStartedAt: number | null,
	isRerun: boolean,
): number {
	if (isRerun) return now + RERUN_DEBOUNCE_MS
	if (bufferStartedAt === null) return now + DEBOUNCE_BASE_MS
	return Math.min(bufferStartedAt + DEBOUNCE_CAP_MS, now + DEBOUNCE_EXTEND_MS)
}

export function migrateBufferEntries(entries: BufferedMessage[]): BufferedMessage[] {
	return entries.map((entry) => {
		const raw = entry as unknown as Record<string, unknown>
		if ("text" in raw && !("parts" in raw)) {
			return {
				sourceMessageId: (raw.messageId as number) ?? 0,
				date: (raw.date as number) ?? 0,
				textSummary: (raw.text as string) ?? "",
				parts: raw.text ? [{ type: "text" as const, text: raw.text as string }] : [],
				mediaGroupId: null,
				from: null,
				rawSource: null,
			} satisfies BufferedMessage
		}
		return entry
	})
}
