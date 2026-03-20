import { and, asc, desc, eq, isNull, lte, or, schema, sql } from "@amby/db"
import type { LanguageModel } from "ai"
import { generateObject, generateText } from "ai"
import { Effect } from "effect"
import { z } from "zod"
import { AgentError } from "./errors"

const GAP_CONTINUE_MS = 120_000
const DORMANT_MS = 60 * 60 * 1000
const STALE_ARCHIVE_MS = 24 * 60 * 60 * 1000
const OPEN_THREADS_CAP = 10
const TAIL_BUDGET = 20

export type RouteAction = "continue" | "switch" | "new"

export type RouteDecision = {
	action: RouteAction
	threadId: string
	label?: string
	confidence: number
}

export type OpenThreadRow = {
	id: string
	label: string | null
	synopsis: string | null
	status: "open" | "archived"
	lastActiveAt: Date
}

const routeObjectSchema = z.object({
	action: z.enum(["continue", "switch", "new"]),
	/** 0-based index into the candidate open-threads list (newest-first). Only for switch. */
	threadIndex: z.number().int().min(0).optional().nullable(),
	/** Short label when action is "new" (e.g. topic name). */
	label: z.string().max(120).optional(),
})

export function routeMessage(
	message: string,
	lastThreadId: string,
	lastMessageAt: Date,
	openThreads: ReadonlyArray<{ id: string; label: string | null; synopsis: string | null }>,
): RouteDecision | null {
	const gapMs = Date.now() - lastMessageAt.getTime()
	if (gapMs < GAP_CONTINUE_MS) {
		return { action: "continue", threadId: lastThreadId, confidence: 0.85 }
	}

	const msgLower = message.toLowerCase()
	for (const thread of openThreads) {
		if (thread.label && msgLower.includes(thread.label.toLowerCase())) {
			return { action: "switch", threadId: thread.id, confidence: 0.8 }
		}
	}

	return null
}

function buildRouterPrompt(
	message: string,
	openThreads: ReadonlyArray<{ id: string; label: string | null; synopsis: string | null }>,
): string {
	const lines = openThreads.map((t, i) => {
		const label = t.label?.trim() || "(untitled)"
		const syn = t.synopsis?.trim() || "(no summary yet)"
		return `${i}. id=${t.id} label="${label}" synopsis: ${syn}`
	})
	return `You route a user message to exactly one conversation thread. Prefer continuing the most recently active thread unless the message clearly starts a new topic or clearly refers to another listed thread.

Open threads (newest first, index 0 = most recent):
${lines.length ? lines.join("\n") : "(none)"}

User message:
${message}

Return JSON only via the schema:
- action "continue": stay on the current active thread (index 0 if unsure).
- action "switch": pick threadIndex for a different listed thread.
- action "new": the user is clearly starting a unrelated new topic; provide a short label.
Bias toward "continue" when ambiguous.`
}

export async function routeWithModel(
	model: LanguageModel,
	message: string,
	openThreads: ReadonlyArray<{ id: string; label: string | null; synopsis: string | null }>,
	lastThreadId: string,
): Promise<RouteDecision> {
	const candidateThreads =
		openThreads.length > 0 ? openThreads : [{ id: lastThreadId, label: null, synopsis: null }]

	const { object } = await generateObject({
		model,
		schema: routeObjectSchema,
		prompt: buildRouterPrompt(message, candidateThreads.slice(0, OPEN_THREADS_CAP)),
	})

	if (object.action === "new") {
		return {
			action: "new",
			threadId: crypto.randomUUID(),
			label: object.label?.trim() || undefined,
			confidence: 0.7,
		}
	}

	if (object.action === "switch") {
		const idx = object.threadIndex ?? 0
		const picked = candidateThreads[idx]
		if (picked) {
			return { action: "switch", threadId: picked.id, confidence: 0.72 }
		}
	}

	return { action: "continue", threadId: lastThreadId, confidence: 0.65 }
}

type QueryFn = <T>(
	fn: (db: import("@amby/db").Database) => Promise<T>,
) => Effect.Effect<T, import("@amby/db").DbError>

export async function generateSynopsis(model: LanguageModel, transcript: string): Promise<string> {
	const { text } = await generateText({
		model,
		prompt: `Summarize this conversation thread in 2-3 sentences. Focus on: what the user wanted, what was done, and any outstanding items.

Thread transcript:
${transcript}`,
	})
	return text.trim()
}

export function archiveStaleThreads(
	query: QueryFn,
	conversationId: string,
	defaultThreadId: string,
	model: LanguageModel,
): Effect.Effect<void, AgentError> {
	const cutoff = new Date(Date.now() - STALE_ARCHIVE_MS)
	return Effect.gen(function* () {
		const stale = yield* query((d) =>
			d
				.select({
					id: schema.conversationThreads.id,
					synopsis: schema.conversationThreads.synopsis,
				})
				.from(schema.conversationThreads)
				.where(
					and(
						eq(schema.conversationThreads.conversationId, conversationId),
						eq(schema.conversationThreads.status, "open"),
						lte(schema.conversationThreads.lastActiveAt, cutoff),
					),
				),
		)

		for (const row of stale) {
			if (!row.synopsis?.trim()) {
				const msgs = yield* query((d) =>
					d
						.select({ role: schema.messages.role, content: schema.messages.content })
						.from(schema.messages)
						.where(messageThreadFilter(conversationId, row.id, defaultThreadId))
						.orderBy(desc(schema.messages.createdAt))
						.limit(TAIL_BUDGET),
				)
				const lines = msgs
					.reverse()
					.map((m) => `${m.role}: ${m.content}`)
					.join("\n")
				if (lines.trim()) {
					const synopsis = yield* Effect.tryPromise({
						try: () => generateSynopsis(model, lines),
						catch: (cause) =>
							new AgentError({ message: "Failed to generate synopsis for archival", cause }),
					})
					yield* query((d) =>
						d
							.update(schema.conversationThreads)
							.set({ synopsis, status: "archived" })
							.where(eq(schema.conversationThreads.id, row.id)),
					)
					continue
				}
			}
			yield* query((d) =>
				d
					.update(schema.conversationThreads)
					.set({ status: "archived" })
					.where(eq(schema.conversationThreads.id, row.id)),
			)
		}
	}).pipe(
		Effect.mapError((e) =>
			e instanceof AgentError
				? e
				: new AgentError({ message: "archiveStaleThreads failed", cause: e }),
		),
	)
}

export function ensureDefaultThread(
	query: QueryFn,
	conversationId: string,
): Effect.Effect<string, AgentError> {
	return query((d) =>
		d.transaction(async (tx) => {
			const existing = await tx
				.select({ id: schema.conversationThreads.id })
				.from(schema.conversationThreads)
				.where(eq(schema.conversationThreads.conversationId, conversationId))
				.orderBy(asc(schema.conversationThreads.createdAt))
				.limit(1)

			if (existing[0]) return existing[0].id

			const rows = await tx
				.insert(schema.conversationThreads)
				.values({ conversationId, status: "open" })
				.returning({ id: schema.conversationThreads.id })

			const row = rows[0]
			if (!row) throw new Error("Failed to create default thread")
			return row.id
		}),
	).pipe(
		Effect.mapError(
			(e) =>
				new AgentError({
					message: `ensureDefaultThread failed: ${e instanceof Error ? e.message : String(e)}`,
					cause: e,
				}),
		),
	)
}

export type ResolveThreadResult = {
	threadId: string
	defaultThreadId: string
	decision: RouteDecision
	threadMessageCount: number
	previousLastThreadId: string
	/** True if this thread had no activity for >1h before this turn (synopsis bridge). */
	threadWasDormant: boolean
}

export function messageThreadFilter(
	conversationId: string,
	resolvedThreadId: string,
	defaultThreadId: string,
) {
	const threadScope =
		resolvedThreadId === defaultThreadId
			? or(eq(schema.messages.threadId, resolvedThreadId), isNull(schema.messages.threadId))
			: eq(schema.messages.threadId, resolvedThreadId)
	return and(eq(schema.messages.conversationId, conversationId), threadScope)
}

export function resolveThread(
	query: QueryFn,
	conversationId: string,
	inboundText: string,
	model: LanguageModel,
): Effect.Effect<ResolveThreadResult, AgentError> {
	return Effect.gen(function* () {
		const defaultThreadId = yield* ensureDefaultThread(query, conversationId)

		yield* archiveStaleThreads(query, conversationId, defaultThreadId, model)

		const openThreadRows = yield* query((d) =>
			d
				.select({
					id: schema.conversationThreads.id,
					label: schema.conversationThreads.label,
					synopsis: schema.conversationThreads.synopsis,
					status: schema.conversationThreads.status,
					lastActiveAt: schema.conversationThreads.lastActiveAt,
				})
				.from(schema.conversationThreads)
				.where(
					and(
						eq(schema.conversationThreads.conversationId, conversationId),
						eq(schema.conversationThreads.status, "open"),
					),
				)
				.orderBy(desc(schema.conversationThreads.lastActiveAt))
				.limit(OPEN_THREADS_CAP),
		)

		const openThreads: OpenThreadRow[] = openThreadRows.map((r) => ({
			id: r.id,
			label: r.label,
			synopsis: r.synopsis,
			status: r.status,
			lastActiveAt: r.lastActiveAt,
		}))

		const lastMsg = yield* query((d) =>
			d
				.select({
					threadId: schema.messages.threadId,
					createdAt: schema.messages.createdAt,
				})
				.from(schema.messages)
				.where(eq(schema.messages.conversationId, conversationId))
				.orderBy(desc(schema.messages.createdAt))
				.limit(1),
		)

		const lastRow = lastMsg[0]
		const lastMessageAt = lastRow?.createdAt ?? new Date()
		const previousLastThreadId = lastRow?.threadId ?? defaultThreadId

		const heuristic = routeMessage(inboundText, previousLastThreadId, lastMessageAt, openThreads)

		const decision: RouteDecision = heuristic
			? heuristic
			: yield* Effect.tryPromise({
					try: () => routeWithModel(model, inboundText, openThreads, previousLastThreadId),
					catch: (cause) => new AgentError({ message: "Thread routing model call failed", cause }),
				})

		let resolvedThreadId = decision.threadId
		const now = new Date()

		const metaBefore = yield* query((d) =>
			d
				.select({ lastActiveAt: schema.conversationThreads.lastActiveAt })
				.from(schema.conversationThreads)
				.where(eq(schema.conversationThreads.id, resolvedThreadId))
				.limit(1),
		)
		const threadWasDormant = metaBefore[0]
			? now.getTime() - metaBefore[0].lastActiveAt.getTime() > DORMANT_MS
			: false

		if (decision.action === "new") {
			const rows = yield* query((d) =>
				d
					.insert(schema.conversationThreads)
					.values({
						id: resolvedThreadId,
						conversationId,
						label: decision.label ?? null,
						status: "open",
						lastActiveAt: now,
					})
					.returning({ id: schema.conversationThreads.id }),
			)
			const row = rows[0]
			if (!row) {
				return yield* Effect.fail(new AgentError({ message: "Failed to insert new thread" }))
			}
			resolvedThreadId = row.id
		} else {
			const existing = yield* query((d) =>
				d
					.select({
						id: schema.conversationThreads.id,
						status: schema.conversationThreads.status,
					})
					.from(schema.conversationThreads)
					.where(eq(schema.conversationThreads.id, resolvedThreadId))
					.limit(1),
			)
			const row = existing[0]
			if (row?.status === "archived") {
				yield* query((d) =>
					d
						.update(schema.conversationThreads)
						.set({ status: "open", lastActiveAt: now })
						.where(eq(schema.conversationThreads.id, resolvedThreadId)),
				)
			} else if (row) {
				yield* query((d) =>
					d
						.update(schema.conversationThreads)
						.set({ lastActiveAt: now })
						.where(eq(schema.conversationThreads.id, resolvedThreadId)),
				)
			}
		}

		const countRows = yield* query((d) =>
			d
				.select({ c: sql<number>`count(*)::int` })
				.from(schema.messages)
				.where(messageThreadFilter(conversationId, resolvedThreadId, defaultThreadId)),
		)
		const threadMessageCount = Number(countRows[0]?.c ?? 0)

		return {
			threadId: resolvedThreadId,
			defaultThreadId,
			decision,
			threadMessageCount,
			previousLastThreadId,
			threadWasDormant,
		}
	}).pipe(
		Effect.mapError((e) =>
			e instanceof AgentError ? e : new AgentError({ message: "resolveThread failed", cause: e }),
		),
	)
}
