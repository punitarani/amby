import {
	and,
	type Database,
	type DbError,
	desc,
	type ExecutionMode,
	eq,
	inArray,
	type SpecialistKind,
	schema,
	type TaskStatus,
	type TraceEventKind,
} from "@amby/db"
import { Effect } from "effect"
import type { AgentRunConfig } from "../types/agent"
import type { ExecutionRequestEnvelope, ExecutionResponseEnvelope } from "../types/persistence"

type QueryFn = <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, DbError>

export type TraceWriter = {
	traceId: string
	append: (kind: TraceEventKind, payload: Record<string, unknown>) => Effect.Effect<void, DbError>
	appendMany: (
		events: Array<{ kind: TraceEventKind; payload: Record<string, unknown> }>,
	) => Effect.Effect<void, DbError>
	setMode: (mode: ExecutionMode) => Effect.Effect<void, DbError>
	updateMetadata: (metadata: Record<string, unknown>) => Effect.Effect<void, DbError>
	linkMessage: (messageId?: string) => Effect.Effect<void, DbError>
	complete: (
		status: "completed" | "failed",
		metadata?: Record<string, unknown>,
	) => Effect.Effect<void, DbError>
}

type CreateTraceParams = {
	query: QueryFn
	conversationId: string
	threadId?: string
	messageId?: string
	parentTraceId?: string
	rootTraceId?: string
	taskId?: string
	specialist: SpecialistKind
	runnerKind?: "toolloop" | "browser_service" | "background_handoff"
	mode: ExecutionMode
	depth: number
	metadata?: Record<string, unknown>
}

function makeTraceWriter(query: QueryFn, traceId: string): TraceWriter {
	const insertEvents = (
		events: Array<{ kind: TraceEventKind; payload: Record<string, unknown> }>,
	) =>
		query(async (db) => {
			const lastRows = await db
				.select({ seq: schema.traceEvents.seq })
				.from(schema.traceEvents)
				.where(eq(schema.traceEvents.traceId, traceId))
				.orderBy(desc(schema.traceEvents.seq))
				.limit(1)

			let nextSeq = (lastRows[0]?.seq ?? -1) + 1
			await db.insert(schema.traceEvents).values(
				events.map((event) => ({
					traceId,
					seq: nextSeq++,
					kind: event.kind,
					payload: event.payload,
				})),
			)
		}).pipe(Effect.asVoid)

	return {
		traceId,
		append: (kind, payload) => insertEvents([{ kind, payload }]),
		appendMany: insertEvents,
		setMode: (mode) =>
			query((db) =>
				db.update(schema.traces).set({ mode }).where(eq(schema.traces.id, traceId)),
			).pipe(Effect.asVoid),
		updateMetadata: (metadata) =>
			query((db) =>
				db.update(schema.traces).set({ metadata }).where(eq(schema.traces.id, traceId)),
			).pipe(Effect.asVoid),
		linkMessage: (messageId) =>
			query((db) =>
				db
					.update(schema.traces)
					.set({ messageId: messageId ?? null })
					.where(eq(schema.traces.id, traceId)),
			).pipe(Effect.asVoid),
		complete: (status, metadata) =>
			query((db) =>
				db
					.update(schema.traces)
					.set({
						status,
						metadata: metadata ?? undefined,
						completedAt: new Date(),
					})
					.where(eq(schema.traces.id, traceId)),
			).pipe(Effect.asVoid),
	}
}

export function createTrace(params: CreateTraceParams): Effect.Effect<TraceWriter, DbError> {
	return params
		.query((db) =>
			db
				.insert(schema.traces)
				.values({
					conversationId: params.conversationId,
					threadId: params.threadId,
					messageId: params.messageId,
					parentTraceId: params.parentTraceId,
					rootTraceId: params.rootTraceId ?? null,
					taskId: params.taskId ?? null,
					specialist: params.specialist,
					runnerKind: params.runnerKind ?? null,
					mode: params.mode,
					depth: params.depth,
					metadata: params.metadata,
					status: "running",
				})
				.returning({ id: schema.traces.id }),
		)
		.pipe(
			Effect.map((rows) => {
				const traceId = rows[0]?.id
				if (!traceId) throw new Error("Failed to create trace")
				return makeTraceWriter(params.query, traceId)
			}),
		)
}

export function buildRootTraceMetadata(config: AgentRunConfig, extra?: Record<string, unknown>) {
	return {
		requestId: config.request.requestId,
		conversationId: config.request.conversationId,
		threadId: config.request.threadId ?? null,
		userId: config.request.userId,
		mode: config.request.mode,
		...extra,
	}
}

export function buildTaskMetadata(params: {
	request: ExecutionRequestEnvelope
	response?: ExecutionResponseEnvelope
	extra?: Record<string, unknown>
}): Record<string, unknown> {
	return {
		request: params.request as unknown as Record<string, unknown>,
		...(params.response ? { response: params.response as unknown as Record<string, unknown> } : {}),
		...(params.extra ?? {}),
	}
}

export function createRootTrace(
	query: QueryFn,
	config: AgentRunConfig,
	metadata?: Record<string, unknown>,
): Effect.Effect<TraceWriter, DbError> {
	return createTrace({
		query,
		conversationId: config.request.conversationId,
		threadId: config.request.threadId,
		specialist: "conversation",
		mode: "direct",
		depth: 0,
		metadata: buildRootTraceMetadata(config, metadata),
	})
}

export function listRecentBackgroundTasks(
	query: QueryFn,
	conversationId: string,
	limit: number,
	includeCompleted: boolean,
): Effect.Effect<(typeof schema.tasks.$inferSelect)[], DbError> {
	const nonTerminal: TaskStatus[] = ["pending", "awaiting_auth", "preparing", "running"]
	return query((db) => {
		const where = includeCompleted
			? eq(schema.tasks.conversationId, conversationId)
			: and(
					eq(schema.tasks.conversationId, conversationId),
					inArray(schema.tasks.status, nonTerminal),
				)
		return db
			.select()
			.from(schema.tasks)
			.where(where)
			.orderBy(desc(schema.tasks.createdAt))
			.limit(limit)
	})
}

export function getBackgroundTaskById(
	query: QueryFn,
	taskId: string,
): Effect.Effect<typeof schema.tasks.$inferSelect | null, DbError> {
	return query((db) =>
		db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1),
	).pipe(Effect.map((rows) => rows[0] ?? null))
}

export function appendTraceLifecycleEvent(
	query: QueryFn,
	traceId: string,
	kind: "delegation_end" | "error",
	payload: Record<string, unknown>,
): Effect.Effect<void, DbError> {
	return query(async (db) => {
		await db.transaction(async (tx) => {
			const existing = await tx
				.select({ seq: schema.traceEvents.seq })
				.from(schema.traceEvents)
				.where(eq(schema.traceEvents.traceId, traceId))
				.orderBy(desc(schema.traceEvents.seq))
				.limit(1)
			const nextSeq = (existing[0]?.seq ?? -1) + 1
			await tx.insert(schema.traceEvents).values({
				traceId,
				seq: nextSeq,
				kind,
				payload,
			})
		})
	})
}

export function markTraceComplete(
	query: QueryFn,
	traceId: string,
	status: "completed" | "failed",
	metadata?: Record<string, unknown>,
): Effect.Effect<void, DbError> {
	return query((db) =>
		db
			.update(schema.traces)
			.set({
				status,
				metadata: metadata ?? undefined,
				completedAt: new Date(),
			})
			.where(eq(schema.traces.id, traceId)),
	).pipe(Effect.asVoid)
}
