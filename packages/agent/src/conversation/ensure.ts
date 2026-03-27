import type { Platform } from "@amby/core"
import { type Database, schema } from "@amby/db"
import { Effect } from "effect"
import { AgentError } from "../errors"

/**
 * Upsert a conversation for the given user + platform + external key.
 *
 * Returns the conversation ID. If a matching conversation already exists
 * (same user, platform, workspace, and external key), its `updatedAt`
 * timestamp is bumped and the existing ID is returned.
 */
export function ensureConversation(
	query: <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, unknown>,
	userId: string,
	platform: Platform,
	externalConversationKey: string,
	workspaceKey?: string,
): Effect.Effect<string, AgentError> {
	return query((database) =>
		database
			.insert(schema.conversations)
			.values({
				userId,
				platform,
				externalConversationKey,
				workspaceKey: workspaceKey ?? "",
			})
			.onConflictDoUpdate({
				target: [
					schema.conversations.userId,
					schema.conversations.platform,
					schema.conversations.workspaceKey,
					schema.conversations.externalConversationKey,
				],
				set: { updatedAt: new Date() },
			})
			.returning({ id: schema.conversations.id }),
	).pipe(
		Effect.map((rows) => {
			const row = rows[0]
			if (!row) throw new Error("Failed to ensure conversation")
			return row.id
		}),
		Effect.mapError(
			(cause) =>
				new AgentError({
					message: cause instanceof Error ? cause.message : "Failed to ensure conversation",
					cause,
				}),
		),
	)
}
