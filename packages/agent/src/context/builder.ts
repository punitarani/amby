import { getChannelPresentation } from "@amby/core"
import { eq, schema } from "@amby/db"
import { Effect } from "effect"
import {
	formatArtifactRecap,
	loadOtherThreadSummaries,
	loadThreadArtifacts,
	loadThreadTail,
} from "../context"
import type { ResolveThreadResult } from "../router"
import { buildConversationPrompt, type ConversationPromptRuntime } from "../specialists/prompts"

type QueryFn = <T>(
	fn: (db: import("@amby/db").Database) => Promise<T>,
) => Effect.Effect<T, import("@amby/db").DbError>

export type PreparedConversationContext = {
	history: Array<{ role: "user" | "assistant"; content: string }>
	systemPrompt: string
	sharedPromptContext: string
	userTimezone: string
	formattedNow: string
}

/**
 * Prepare conversation context for a turn.
 *
 * Memory context is injected via plugin context contributors in the engine,
 * NOT loaded here. This keeps agent decoupled from @amby/memory.
 */
export function prepareConversationContext(params: {
	query: QueryFn
	userId: string
	conversationId: string
	threadCtx: ResolveThreadResult
	memoryContext?: string
	runtime?: ConversationPromptRuntime
}): Effect.Effect<PreparedConversationContext, import("@amby/db").DbError> {
	const { query, userId, conversationId, threadCtx, memoryContext, runtime } = params

	return Effect.gen(function* () {
		const userRows = yield* query((db) =>
			db
				.select({ timezone: schema.users.timezone })
				.from(schema.users)
				.where(eq(schema.users.id, userId))
				.limit(1),
		)

		const userTimezone = userRows[0]?.timezone ?? "UTC"
		const formattedNow = new Intl.DateTimeFormat("en-US", {
			timeZone: userTimezone,
			dateStyle: "full",
			timeStyle: "long",
		}).format(new Date())

		const [conversationRows, threadRows, history, otherThreads, artifactRows] = yield* Effect.all(
			[
				query((db) =>
					db
						.select({ platform: schema.conversations.platform })
						.from(schema.conversations)
						.where(eq(schema.conversations.id, conversationId))
						.limit(1),
				),
				query((db) =>
					db
						.select({
							label: schema.conversationThreads.label,
							synopsis: schema.conversationThreads.synopsis,
						})
						.from(schema.conversationThreads)
						.where(eq(schema.conversationThreads.id, threadCtx.threadId))
						.limit(1),
				),
				loadThreadTail(
					query,
					conversationId,
					threadCtx.threadId,
					undefined,
					threadCtx.threadId === threadCtx.defaultThreadId,
				),
				loadOtherThreadSummaries(query, conversationId, threadCtx.threadId),
				loadThreadArtifacts(
					query,
					conversationId,
					threadCtx.threadId,
					threadCtx.threadId === threadCtx.defaultThreadId,
				),
			],
			{ concurrency: 4 },
		)

		const threadLabel = threadRows[0]?.label ?? null
		const threadSynopsis = threadRows[0]?.synopsis?.trim() ?? ""
		const channel = getChannelPresentation(conversationRows[0]?.platform ?? "telegram")
		const artifactRecap = formatArtifactRecap(artifactRows, threadLabel)

		const extraContext = [
			otherThreads,
			threadCtx.threadWasDormant && threadSynopsis
				? `## Resumed thread synopsis\n${threadSynopsis}`
				: "",
			artifactRecap,
		]
			.filter(Boolean)
			.join("\n\n")

		const sharedPromptContext = [
			memoryContext ? `# User Memory Context\n${memoryContext}` : "",
			extraContext,
			`# Current Date/Time\n${formattedNow} (${userTimezone})`,
		]
			.filter(Boolean)
			.join("\n\n")

		const systemPrompt = [
			buildConversationPrompt(formattedNow, userTimezone, runtime, channel),
			memoryContext ? `# User Memory Context\n${memoryContext}` : "",
			extraContext,
		]
			.filter(Boolean)
			.join("\n\n")

		return {
			history,
			systemPrompt,
			sharedPromptContext,
			userTimezone,
			formattedNow,
		}
	})
}
