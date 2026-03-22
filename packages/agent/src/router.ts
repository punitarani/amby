import type { ThreadSource } from "@amby/db"
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

export type RouteSource = "native" | "reply_chain" | "derived" | "manual"
export type RouteAction = "continue" | "switch" | "new"

export type RouteDecision = {
	action: RouteAction
	threadId: string
	source: RouteSource
	label?: string
	keywords?: string[]
}

export type OpenThreadRow = {
	id: string
	label: string | null
	synopsis: string | null
	keywords: string[] | null
	lastActiveAt: Date
}

export type PlatformContext = {
	threadKey?: string
	replyToMessageId?: string
}

const routeObjectSchema = z.object({
	action: z.enum(["continue", "switch", "new"]),
	threadIndex: z.number().int().min(0).optional().nullable(),
	label: z.string().max(120).optional(),
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
		return { action: "continue", threadId: lastThreadId, source: "derived" }
	}

	for (const thread of openThreads) {
		if (thread.label && matchesLabel(message, thread.label)) {
			return { action: "switch", threadId: thread.id, source: "derived" }
		}
	}

	for (const thread of openThreads) {
		if (!thread.keywords?.length) continue
		const hits = thread.keywords.filter((kw) => matchesLabel(message, kw)).length
		if (hits >= 2) {
			return { action: "switch", threadId: thread.id, source: "derived" }
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
	if (openThreads.length === 0) {
		return { action: "new", threadId: crypto.randomUUID(), source: "derived" }
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
			source: "derived",
			label: object.label?.trim() || undefined,
			keywords: object.keywords?.length ? object.keywords : undefined,
		}
	}

	if (object.action === "switch") {
		const idx = object.threadIndex ?? 0
		const picked = openThreads[idx]
		if (picked) {
			return { action: "switch", threadId: picked.id, source: "derived" }
		}
		console.warn(
			`[Router] threadIndex=${idx} out of bounds (max=${openThreads.length - 1}), falling back to continue`,
		)
	}

	return { action: "continue", threadId: lastThreadId, source: "derived" }
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
	const now = Date.now()
	const cutoff = new Date(now - STALE_ARCHIVE_MS)
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

// --- ensureDefaultThread with unique partial index ---

export function ensureDefaultThread(
	query: QueryFn,
	conversationId: string,
): Effect.Effect<string, AgentError> {
	return Effect.gen(function* () {
		// Try insert with onConflictDoNothing on the unique partial index
		const rows = yield* query((d) =>
			d
				.insert(schema.conversationThreads)
				.values({
					conversationId,
					source: "derived" as const,
					isDefault: true,
					status: "open",
				})
				.onConflictDoNothing()
				.returning({ id: schema.conversationThreads.id }),
		)

		if (rows[0]) return rows[0].id

		// Conflict — select the existing default thread
		const existing = yield* query((d) =>
			d
				.select({ id: schema.conversationThreads.id })
				.from(schema.conversationThreads)
				.where(
					and(
						eq(schema.conversationThreads.conversationId, conversationId),
						eq(schema.conversationThreads.isDefault, true),
					),
				)
				.limit(1),
		)

		if (existing[0]) return existing[0].id

		// Shouldn't happen, but fallback to oldest thread
		const fallback = yield* query((d) =>
			d
				.select({ id: schema.conversationThreads.id })
				.from(schema.conversationThreads)
				.where(eq(schema.conversationThreads.conversationId, conversationId))
				.orderBy(asc(schema.conversationThreads.createdAt))
				.limit(1),
		)

		if (fallback[0]) return fallback[0].id

		return yield* Effect.fail(new AgentError({ message: "Failed to create default thread" }))
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

// --- messageThreadFilter ---
// When includeUnthreaded is true, also matches messages with NULL thread_id.
// Use this for the default thread so pre-migration messages (which have no
// thread_id) are visible instead of silently dropped by strict equality.

export function messageThreadFilter(
	conversationId: string,
	threadId: string,
	includeUnthreaded = false,
) {
	const threadCondition = includeUnthreaded
		? or(eq(schema.messages.threadId, threadId), isNull(schema.messages.threadId))
		: eq(schema.messages.threadId, threadId)
	return and(eq(schema.messages.conversationId, conversationId), threadCondition)
}

// --- ResolveThreadResult ---

export type ResolveThreadResult = {
	threadId: string
	defaultThreadId: string
	decision: RouteDecision
	threadMessageCount: number
	previousLastThreadId: string
	threadWasDormant: boolean
}

// --- resolveThread: 4-step resolution ---

export function resolveThread(
	query: QueryFn,
	conversationId: string,
	inboundText: string,
	model: LanguageModel,
	platformContext?: PlatformContext,
): Effect.Effect<ResolveThreadResult, AgentError> {
	return Effect.gen(function* () {
		const defaultThreadId = yield* ensureDefaultThread(query, conversationId)

		yield* archiveStaleThreads(query, conversationId, model).pipe(
			Effect.catchAll(() => Effect.void),
		)

		// Step 1: Native thread (platform thread key)
		if (platformContext?.threadKey) {
			const existing = yield* query((d) =>
				d
					.select({ id: schema.conversationThreads.id })
					.from(schema.conversationThreads)
					.where(
						and(
							eq(schema.conversationThreads.conversationId, conversationId),
							eq(schema.conversationThreads.externalThreadKey, platformContext.threadKey ?? ""),
						),
					)
					.limit(1),
			)

			let threadId: string
			if (existing[0]) {
				threadId = existing[0].id
				yield* query((d) =>
					d
						.update(schema.conversationThreads)
						.set({ status: "open", lastActiveAt: new Date() })
						.where(eq(schema.conversationThreads.id, threadId)),
				)
			} else {
				const rows = yield* query((d) =>
					d
						.insert(schema.conversationThreads)
						.values({
							conversationId,
							source: "native" as ThreadSource,
							externalThreadKey: platformContext.threadKey,
							status: "open",
							lastActiveAt: new Date(),
						})
						.returning({ id: schema.conversationThreads.id }),
				)
				const row = rows[0]
				if (!row) {
					return yield* Effect.fail(new AgentError({ message: "Failed to create native thread" }))
				}
				threadId = row.id
			}

			const countRows = yield* query((d) =>
				d
					.select({ c: sql<number>`count(*)::int` })
					.from(schema.messages)
					.where(messageThreadFilter(conversationId, threadId)),
			)

			return {
				threadId,
				defaultThreadId,
				decision: { action: "continue" as RouteAction, threadId, source: "native" as RouteSource },
				threadMessageCount: Number(countRows[0]?.c ?? 0),
				previousLastThreadId: defaultThreadId,
				threadWasDormant: false,
			}
		}

		// Step 2: Reply chain — future, skip for now (would follow replyToMessageId)

		// Step 3: Derived (heuristic + model fallback)
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

		if (!lastRow) {
			return {
				threadId: defaultThreadId,
				defaultThreadId,
				decision: {
					action: "continue" as RouteAction,
					threadId: defaultThreadId,
					source: "derived" as RouteSource,
				},
				threadMessageCount: 0,
				previousLastThreadId: defaultThreadId,
				threadWasDormant: false,
			}
		}

		const lastMessageAt = lastRow.createdAt
		const previousLastThreadId = lastRow.threadId ?? defaultThreadId

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
						source: "derived" as ThreadSource,
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
						.where(
							messageThreadFilter(
								conversationId,
								resolvedThreadId,
								resolvedThreadId === defaultThreadId,
							),
						),
				),
			],
			{ concurrency: 2 },
		)

		const metaRow = threadMeta[0]
		const threadWasDormant = metaRow
			? now.getTime() - metaRow.lastActiveAt.getTime() > DORMANT_MS
			: false

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
