import { desc, eq, schema } from "@amby/db"
import type { LanguageModel } from "ai"
import { Effect } from "effect"
import { THREAD_TAIL_LIMIT } from "./context"
import { AgentError } from "./errors"
import {
	DORMANT_MS,
	generateSynopsis,
	messageThreadFilter,
	type ResolveThreadResult,
} from "./router"

type QueryFn = <T>(
	fn: (db: import("@amby/db").Database) => Promise<T>,
) => Effect.Effect<T, import("@amby/db").DbError>

export function fetchTranscriptForSynopsis(
	query: QueryFn,
	conversationId: string,
	threadId: string,
	includeUnthreaded = false,
) {
	return query((d) =>
		d
			.select({ role: schema.messages.role, content: schema.messages.content })
			.from(schema.messages)
			.where(messageThreadFilter(conversationId, threadId, includeUnthreaded))
			.orderBy(desc(schema.messages.createdAt))
			.limit(THREAD_TAIL_LIMIT),
	).pipe(
		Effect.map((rows) =>
			rows
				.reverse()
				.map((m) => `${m.role}: ${m.content}`)
				.join("\n"),
		),
	)
}

export function maybeGenerateSynopsis(
	query: QueryFn,
	model: LanguageModel,
	threadId: string,
	conversationId: string,
	includeUnthreaded = false,
) {
	return Effect.gen(function* () {
		const transcript = yield* fetchTranscriptForSynopsis(
			query,
			conversationId,
			threadId,
			includeUnthreaded,
		)
		if (!transcript.trim()) return

		const { synopsis, keywords } = yield* Effect.tryPromise({
			try: () => generateSynopsis(model, transcript),
			catch: (cause) => new AgentError({ message: "Synopsis generation failed", cause }),
		})
		yield* query((d) =>
			d
				.update(schema.conversationThreads)
				.set({ synopsis, keywords })
				.where(eq(schema.conversationThreads.id, threadId)),
		)
	}).pipe(
		Effect.catchAll((e) =>
			Effect.sync(() => {
				console.warn("[Synopsis] Failed:", e)
			}),
		),
	)
}

export function synopsisPreviousThreadIfDormantSwitch(
	query: QueryFn,
	model: LanguageModel,
	conversationId: string,
	threadCtx: ResolveThreadResult,
) {
	return Effect.gen(function* () {
		const switchedAway =
			threadCtx.previousLastThreadId !== threadCtx.threadId &&
			(threadCtx.decision.action === "switch" || threadCtx.decision.action === "new")

		if (!switchedAway) return

		const prevIsDefault = threadCtx.previousLastThreadId === threadCtx.defaultThreadId
		const lastRows = yield* query((d) =>
			d
				.select({ createdAt: schema.messages.createdAt })
				.from(schema.messages)
				.where(messageThreadFilter(conversationId, threadCtx.previousLastThreadId, prevIsDefault))
				.orderBy(desc(schema.messages.createdAt))
				.limit(1),
		)
		const lastAt = lastRows[0]?.createdAt
		if (!lastAt || Date.now() - lastAt.getTime() <= DORMANT_MS) return

		yield* maybeGenerateSynopsis(
			query,
			model,
			threadCtx.previousLastThreadId,
			conversationId,
			prevIsDefault,
		)
	}).pipe(Effect.catchAll(() => Effect.void))
}

export function synopsisCurrentThreadIfOverflowsAfterSave(
	query: QueryFn,
	model: LanguageModel,
	conversationId: string,
	threadCtx: ResolveThreadResult,
	inboundMessageCount: number,
) {
	return Effect.gen(function* () {
		const projectedCount = threadCtx.threadMessageCount + inboundMessageCount
		if (projectedCount <= THREAD_TAIL_LIMIT) return

		yield* maybeGenerateSynopsis(
			query,
			model,
			threadCtx.threadId,
			conversationId,
			threadCtx.threadId === threadCtx.defaultThreadId,
		)
	}).pipe(Effect.catchAll(() => Effect.void))
}
