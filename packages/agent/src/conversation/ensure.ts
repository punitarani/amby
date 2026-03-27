import type { Platform } from "@amby/core"
import { type Database, schema } from "@amby/db"
import { Effect } from "effect"
import { AgentError } from "../errors"

/**
 * Upsert a conversation for the given user + platform + external key.
 *
 * Returns the conversation ID. If a matching conversation already exists
 * (same user, platform, and external key), its `updatedAt`
 * timestamp is bumped and the existing ID is returned.
 */
export function ensureConversation(
	query: <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, unknown>,
	userId: string,
	platform: Platform,
	externalConversationKey: string,
): Effect.Effect<string, AgentError> {
	return query((database) =>
		database
			.insert(schema.conversations)
			.values({
				userId,
				platform,
				externalConversationKey,
			})
			.onConflictDoUpdate({
				target: [
					schema.conversations.userId,
					schema.conversations.platform,
					schema.conversations.externalConversationKey,
				],
				set: { updatedAt: new Date() },
			})
			.returning({ id: schema.conversations.id }),
	).pipe(
		Effect.mapError(
			(cause) =>
				new AgentError({
					message: cause instanceof Error ? cause.message : "Failed to ensure conversation",
					cause,
				}),
		),
		Effect.flatMap((rows) => {
			const row = rows[0]
			if (!row) return Effect.fail(new AgentError({ message: "Failed to ensure conversation" }))
			return Effect.succeed(row.id)
		}),
	)
}
