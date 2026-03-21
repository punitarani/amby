/**
 * Channel-specific reply routing for task completion notifications (stored in `tasks.reply_target`).
 */
export type ReplyTarget =
	| { channel: "telegram"; chatId: number }
	| { channel: "cli" }
	| { channel: "web" }

/** Parse `reply_target` JSONB; supports legacy `{ chatId }` without `channel`. */
export function parseReplyTarget(raw: unknown): ReplyTarget | null {
	if (!raw || typeof raw !== "object") return null
	const o = raw as Record<string, unknown>
	if (o.channel === "telegram" && typeof o.chatId === "number" && Number.isFinite(o.chatId)) {
		return { channel: "telegram", chatId: o.chatId }
	}
	if (o.channel === "cli") return { channel: "cli" }
	if (o.channel === "web") return { channel: "web" }
	// Legacy Telegram-only shape
	if (typeof o.chatId === "number" && Number.isFinite(o.chatId)) {
		return { channel: "telegram", chatId: o.chatId }
	}
	return null
}
