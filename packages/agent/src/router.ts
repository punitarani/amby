import { and, asc, desc, eq, inArray, isNull, lte, or, schema, sql } from "@amby/db"
import type { LanguageModel } from "ai"
import { generateObject } from "ai"
import { Effect } from "effect"
import { z } from "zod"
import { AgentError } from "./errors"

const GAP_CONTINUE_MS = 120_000
export const DORMANT_MS = 60 * 60 * 1000
const STALE_ARCHIVE_MS = 24 * 60 * 60 * 1000
const OPEN_THREADS_CAP = 10
const TAIL_BUDGET = 20
const SYNOPSIS_BATCH_CAP = 3

export type RouteAction = "continue" | "switch" | "new"

/**
 * Confidence values are trace-only metadata for observability — they are NOT
 * used for downstream logic (e.g. fallback routing, threshold gating).
 *
 * - 0.85 — heuristic continue (short time gap)
 * - 0.80 — heuristic switch (label substring match)
 * - 0.78 — heuristic switch (keyword match, ≥2 hits)
 * - 0.72 — model-routed switch
 * - 0.70 — model-routed new thread
 * - 0.65 — model-routed continue (default fallback)
 */
export type RouteDecision = {
	action: RouteAction
	threadId: string
	label?: string
	keywords?: string[]
	confidence: number
}

export type OpenThreadRow = {
	id: string
	label: string | null
	synopsis: string | null
	keywords: string[] | null
	lastActiveAt: Date
}

const routeObjectSchema = z.object({
	action: z.enum(["continue", "switch", "new"]),
	/** 0-based index into the candidate open-threads list (newest-first). Only for switch. */
	threadIndex: z.number().int().min(0).optional().nullable(),
	/** Short label when action is "new" (e.g. topic name). */
	label: z.string().max(120).optional(),
	/** 3-5 topic keywords for semantic matching. */
	keywords: z.array(z.string().max(40)).max(5).optional(),
})

function matchesLabel(message: string, label: string): boolean {
	if (label.length < 3) return false
	return new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(message)
}

export function routeMessage(
	message: string,
	lastThreadId: string,
	lastMessageAt: Date,
	openThreads: ReadonlyArray<OpenThreadRow>,
): RouteDecision | null {
	const gapMs = Date.now() - lastMessageAt.getTime()
	if (gapMs < GAP_CONTINUE_MS) {
		return { action: "continue", threadId: lastThreadId, confidence: 0.85 }
	}

	// Label match with word boundaries
	for (const thread of openThreads) {
		if (thread.label && matchesLabel(message, thread.label)) {
			return { action: "switch", threadId: thread.id, confidence: 0.8 }
		}
	}

	// Keyword match: 2+ keyword hits → switch
	for (const thread of openThreads) {
		if (!thread.keywords?.length) continue
		const hits = thread.keywords.filter((kw) => matchesLabel(message, kw)).length
		if (hits >= 2) {
			return { action: "switch", threadId: thread.id, confidence: 0.78 }
		}
	}

	return null
}

function buildRouterPrompt(message: string, openThreads: ReadonlyArray<OpenThreadRow>): string {
	const lines = openThreads.map((t, i) => {
		const label = t.label?.trim() || "(untitled)"
		const syn = t.synopsis?.trim() || "(no summary yet)"
		const kws = t.keywords?.length ? ` keywords: [${t.keywords.join(", ")}]` : ""
		return `${i}. id=${t.id} label="${label}"${kws} synopsis: ${syn}`
	})
	return `You route a user message to exactly one conversation thread. Prefer continuing the most recently active thread unless the message clearly starts a new topic or clearly refers to another listed thread.

Open threads (newest first, index 0 = most recent):
${lines.length ? lines.join("\n") : "(none)"}

User message:
${message}

Return JSON only via the schema:
- action "continue": stay on the current active thread (index 0 if unsure).
- action "switch": pick threadIndex for a different listed thread.
- action "new": the user is clearly starting a unrelated new topic; provide a short label and 3-5 topic keywords.
Bias toward "continue" when ambiguous.`
}

export async function routeWithModel(
	model: LanguageModel,
	message: string,
	openThreads: ReadonlyArray<OpenThreadRow>,
	lastThreadId: string,
): Promise<RouteDecision> {
	// No open threads → skip model call, go straight to "new"
	if (openThreads.length === 0) {
		return { action: "new", threadId: crypto.randomUUID(), confidence: 0.7 }
	}

	const { object } = await generateObject({
		model,
		schema: routeObjectSchema,
		prompt: buildRouterPrompt(message, openThreads.slice(0, OPEN_THREADS_CAP)),
	})

	if (object.action === "new") {
		return {
			action: "new",
			threadId: crypto.randomUUID(),
			label: object.label?.trim() || undefined,
			keywords: object.keywords?.length ? object.keywords : undefined,
			confidence: 0.7,
		}
	}

	if (object.action === "switch") {
		const idx = object.threadIndex ?? 0
		const picked = openThreads[idx]
		if (picked) {
			return { action: "switch", threadId: picked.id, confidence: 0.72 }
		}
		console.warn(
			`[Router] threadIndex=${idx} out of bounds (max=${openThreads.length - 1}), falling back to continue`,
		)
	}

	return { action: "continue", threadId: lastThreadId, confidence: 0.65 }
}

type QueryFn = <T>(
	fn: (db: import("@amby/db").Database) => Promise<T>,
) => Effect.Effect<T, import("@amby/db").DbError>

export async function generateSynopsis(
	model: LanguageModel,
	transcript: string,
): Promise<{ synopsis: string; keywords: string[] }> {
	const { object } = await generateObject({
		model,
		schema: z.object({
			synopsis: z.string(),
			keywords: z.array(z.string().max(40)).max(5),
		}),
		prompt: `Summarize this conversation thread and extract topic keywords.
Synopsis: 2-3 sentences covering what the user wanted, what was done, outstanding items.
Keywords: 3-5 single-word or short-phrase topic identifiers.

Thread transcript:
${transcript}`,
	})
	return { synopsis: object.synopsis.trim(), keywords: object.keywords }
}

export function archiveStaleThreads(
	query: QueryFn,
	conversationId: string,
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

		const needsSynopsis = stale.filter((r) => !r.synopsis?.trim())

		// Batch-fetch messages for all threads needing synopsis in one query
		const threadIds = needsSynopsis.map((r) => r.id)
		const allMsgs =
			threadIds.length > 0
				? yield* query((d) =>
						d
							.select({
								threadId: schema.messages.threadId,
								role: schema.messages.role,
								content: schema.messages.content,
								createdAt: schema.messages.createdAt,
							})
							.from(schema.messages)
							.where(
								and(
									eq(schema.messages.conversationId, conversationId),
									inArray(schema.messages.threadId, threadIds),
								),
							)
							.orderBy(desc(schema.messages.createdAt)),
					)
				: []

		// Group by threadId, take last TAIL_BUDGET per thread
		const msgsByThread = new Map<string, typeof allMsgs>()
		for (const msg of allMsgs) {
			if (!msg.threadId) continue
			const existing = msgsByThread.get(msg.threadId) ?? []
			if (existing.length < TAIL_BUDGET) {
				existing.push(msg)
				msgsByThread.set(msg.threadId, existing)
			}
		}

		let synopsisCount = 0
		for (const row of stale) {
			if (!row.synopsis?.trim() && synopsisCount < SYNOPSIS_BATCH_CAP) {
				const msgs = msgsByThread.get(row.id) ?? []
				const lines = msgs
					.reverse()
					.map((m) => `${m.role}: ${m.content}`)
					.join("\n")
				if (lines.trim()) {
					const { synopsis, keywords } = yield* Effect.tryPromise({
						try: () => generateSynopsis(model, lines),
						catch: (cause) =>
							new AgentError({ message: "Failed to generate synopsis for archival", cause }),
					})
					yield* query((d) =>
						d
							.update(schema.conversationThreads)
							.set({ synopsis, keywords, status: "archived" })
							.where(eq(schema.conversationThreads.id, row.id)),
					)
					synopsisCount++
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
	return Effect.gen(function* () {
		const existing = yield* query((d) =>
			d
				.select({ id: schema.conversationThreads.id })
				.from(schema.conversationThreads)
				.where(eq(schema.conversationThreads.conversationId, conversationId))
				.orderBy(asc(schema.conversationThreads.createdAt))
				.limit(1),
		)

		if (existing[0]) return existing[0].id

		const rows = yield* query((d) =>
			d
				.insert(schema.conversationThreads)
				.values({ conversationId, status: "open" })
				.returning({ id: schema.conversationThreads.id }),
		)

		const row = rows[0]
		if (!row) {
			return yield* Effect.fail(new AgentError({ message: "Failed to create default thread" }))
		}

		return row.id
	}).pipe(
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

		yield* archiveStaleThreads(query, conversationId, model)

		const [openThreadRows, lastMsg] = yield* Effect.all(
			[
				query((d) =>
					d
						.select({
							id: schema.conversationThreads.id,
							label: schema.conversationThreads.label,
							synopsis: schema.conversationThreads.synopsis,
							keywords: schema.conversationThreads.keywords,
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
				),
				query((d) =>
					d
						.select({
							threadId: schema.messages.threadId,
							createdAt: schema.messages.createdAt,
						})
						.from(schema.messages)
						.where(eq(schema.messages.conversationId, conversationId))
						.orderBy(desc(schema.messages.createdAt))
						.limit(1),
				),
			],
			{ concurrency: 2 },
		)

		const openThreads: OpenThreadRow[] = openThreadRows.map((r) => ({
			id: r.id,
			label: r.label,
			synopsis: r.synopsis,
			keywords: r.keywords,
			lastActiveAt: r.lastActiveAt,
		}))

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

		if (decision.action === "new") {
			const rows = yield* query((d) =>
				d
					.insert(schema.conversationThreads)
					.values({
						id: resolvedThreadId,
						conversationId,
						label: decision.label ?? null,
						keywords: decision.keywords ?? null,
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
		}

		// Parallelize thread metadata fetch and message count
		const [threadMeta, countRows] = yield* Effect.all(
			[
				query((d) =>
					d
						.select({
							id: schema.conversationThreads.id,
							status: schema.conversationThreads.status,
							lastActiveAt: schema.conversationThreads.lastActiveAt,
						})
						.from(schema.conversationThreads)
						.where(eq(schema.conversationThreads.id, resolvedThreadId))
						.limit(1),
				),
				query((d) =>
					d
						.select({ c: sql<number>`count(*)::int` })
						.from(schema.messages)
						.where(messageThreadFilter(conversationId, resolvedThreadId, defaultThreadId)),
				),
			],
			{ concurrency: 2 },
		)

		const metaRow = threadMeta[0]
		const threadWasDormant = metaRow
			? now.getTime() - metaRow.lastActiveAt.getTime() > DORMANT_MS
			: false

		// Idempotent update: re-open if archived, always update lastActiveAt
		if (decision.action !== "new" && metaRow) {
			yield* query((d) =>
				d
					.update(schema.conversationThreads)
					.set({ status: "open", lastActiveAt: now })
					.where(eq(schema.conversationThreads.id, resolvedThreadId)),
			)
		}

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
