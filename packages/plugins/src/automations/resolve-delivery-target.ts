import type { Database } from "@amby/db"
import { and, eq, schema } from "@amby/db"

/**
 * Extract Telegram chatId from account metadata.
 *
 * Inlined from packages/computer/src/harness/telegram-chat-id.ts
 * to avoid adding a dependency edge to @amby/computer.
 */
function getTelegramChatId(metadata: unknown): number | undefined {
	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
		return undefined
	}
	const value = (metadata as Record<string, unknown>).chatId
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10)
		return Number.isFinite(parsed) ? parsed : undefined
	}
	return undefined
}

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
		.select({ metadata: schema.accounts.metadata })
		.from(schema.accounts)
		.where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "telegram")))
		.limit(1)

	const chatId = getTelegramChatId(accRows[0]?.metadata)
	if (chatId !== undefined) {
		return { channel: "telegram" as const, chatId }
	}

	return {}
}
