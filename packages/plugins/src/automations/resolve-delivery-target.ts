import type { Database } from "@amby/db"
import { and, eq, schema } from "@amby/db"

/**
 * Resolve the delivery target for an automation from the conversation context.
 *
 * Follows the same pattern as the task supervisor in
 * packages/computer/src/harness/supervisor.ts (lines 908-947).
 *
 * Returns `{ channel: "telegram", chatId }` if the conversation is Telegram-based,
 * or `{}` otherwise.
 */
export async function resolveDeliveryTarget(
	db: Database,
	userId: string,
	conversationId: string,
): Promise<Record<string, unknown>> {
	const convRows = await db
		.select({ platform: schema.conversations.platform })
		.from(schema.conversations)
		.where(eq(schema.conversations.id, conversationId))
		.limit(1)

	if (convRows[0]?.platform !== "telegram") {
		return {}
	}

	const accRows = await db
		.select({ telegramChatId: schema.accounts.telegramChatId })
		.from(schema.accounts)
		.where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "telegram")))
		.limit(1)

	const chatId = accRows[0]?.telegramChatId ? Number.parseInt(accRows[0].telegramChatId, 10) : NaN
	if (Number.isFinite(chatId)) {
		return { channel: "telegram" as const, chatId }
	}

	return {}
}
