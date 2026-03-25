/** Channel-specific reply routing for task completion notifications (stored in `tasks.reply_target`). */
export type ReplyTarget = { channel: "telegram"; chatId: number }

/** Parse `reply_target` JSONB into a typed ReplyTarget. */
export function parseReplyTarget(raw: unknown): ReplyTarget | null {
	if (!raw || typeof raw !== "object") return null
	const o = raw as Record<string, unknown>
	if (o.channel === "telegram" && typeof o.chatId === "number" && Number.isFinite(o.chatId)) {
		return { channel: "telegram", chatId: o.chatId }
	}
	return null
}
