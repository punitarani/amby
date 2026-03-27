import {
	and,
	type Database,
	type DbError,
	desc,
	type ExecutionMode,
	eq,
	inArray,
	type RunEventKind,
	type SpecialistKind,
	schema,
	type TaskStatus,
} from "@amby/db"
import { Effect } from "effect"
import { buildRootRunMetadata } from "../run-metadata"
import type { AgentRunConfig } from "../types/agent"

export type QueryFn = <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, DbError>

export type RunWriter = {
	runId: string
	append: (kind: RunEventKind, payload: Record<string, unknown>) => Effect.Effect<void, DbError>
	appendMany: (
		events: Array<{ kind: RunEventKind; payload: Record<string, unknown> }>,
	) => Effect.Effect<void, DbError>
	setMode: (mode: ExecutionMode) => Effect.Effect<void, DbError>
	updateMetadata: (metadata: Record<string, unknown>) => Effect.Effect<void, DbError>
	linkMessage: (messageId?: string) => Effect.Effect<void, DbError>
	complete: (
		status: "completed" | "failed",
		metadata?: Record<string, unknown>,
	) => Effect.Effect<void, DbError>
}

/** @deprecated Use RunWriter instead. */
export type TraceWriter = RunWriter

type CreateRunParams = {
	query: QueryFn
	conversationId: string
	threadId?: string
	messageId?: string
	parentRunId?: string
	rootRunId?: string
	taskId?: string
	specialist: SpecialistKind
	runnerKind?: "toolloop" | "browser_service" | "background_handoff"
	mode: ExecutionMode
	depth: number
	metadata?: Record<string, unknown>
}

function makeRunWriter(query: QueryFn, runId: string): RunWriter {
	const insertEvents = (events: Array<{ kind: RunEventKind; payload: Record<string, unknown> }>) =>
		query(async (db) => {
			await db.transaction(async (tx) => {
				const lastRows = await tx
					.select({ seq: schema.runEvents.seq })
					.from(schema.runEvents)
					.where(eq(schema.runEvents.runId, runId))
					.orderBy(desc(schema.runEvents.seq))
					.limit(1)

				let nextSeq = (lastRows[0]?.seq ?? -1) + 1
				await tx.insert(schema.runEvents).values(
					events.map((event) => ({
						runId,
						seq: nextSeq++,
						kind: event.kind,
						payload: event.payload,
					})),
				)
			})
		}).pipe(Effect.asVoid)

	return {
		runId,
		append: (kind, payload) => insertEvents([{ kind, payload }]),
		appendMany: insertEvents,
		setMode: (mode) =>
			query((db) => db.update(schema.runs).set({ mode }).where(eq(schema.runs.id, runId))).pipe(
				Effect.asVoid,
			),
		updateMetadata: (metadata) =>
			query((db) => db.update(schema.runs).set({ metadata }).where(eq(schema.runs.id, runId))).pipe(
				Effect.asVoid,
			),
		linkMessage: (messageId) =>
			query((db) =>
				db
					.update(schema.runs)
					.set({ messageId: messageId ?? null })
					.where(eq(schema.runs.id, runId)),
			).pipe(Effect.asVoid),
		complete: (status, metadata) =>
			query((db) =>
				db
					.update(schema.runs)
					.set({
						status,
						metadata: metadata ?? undefined,
						completedAt: new Date(),
					})
					.where(eq(schema.runs.id, runId)),
			).pipe(Effect.asVoid),
	}
}

export function createRun(params: CreateRunParams): Effect.Effect<RunWriter, DbError> {
	return params
		.query((db) =>
			db
				.insert(schema.runs)
				.values({
					conversationId: params.conversationId,
					threadId: params.threadId,
					messageId: params.messageId,
					parentRunId: params.parentRunId,
					rootRunId: params.rootRunId ?? null,
					taskId: params.taskId ?? null,
					specialist: params.specialist,
					runnerKind: params.runnerKind ?? null,
					mode: params.mode,
					depth: params.depth,
					metadata: params.metadata,
					status: "running",
				})
				.returning({ id: schema.runs.id }),
		)
		.pipe(
			Effect.map((rows) => {
				const runId = rows[0]?.id
				if (!runId) throw new Error("Failed to create run")
				return makeRunWriter(params.query, runId)
			}),
		)
}

/** @deprecated Use createRun instead. */
export const createTrace = createRun

export function createRootRun(
	query: QueryFn,
	config: AgentRunConfig,
	metadata?: Record<string, unknown>,
): Effect.Effect<RunWriter, DbError> {
	return createRun({
		query,
		conversationId: config.request.conversationId,
		threadId: config.request.threadId,
		specialist: "conversation",
		mode: "direct",
		depth: 0,
		metadata: buildRootRunMetadata(config, metadata),
	})
}

/** @deprecated Use createRootRun instead. */
export const createRootTrace = createRootRun

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

export function appendRunLifecycleEvent(
	query: QueryFn,
	runId: string,
	kind: "delegation_end" | "error",
	payload: Record<string, unknown>,
): Effect.Effect<void, DbError> {
	return query(async (db) => {
		await db.transaction(async (tx) => {
			const existing = await tx
				.select({ seq: schema.runEvents.seq })
				.from(schema.runEvents)
				.where(eq(schema.runEvents.runId, runId))
				.orderBy(desc(schema.runEvents.seq))
				.limit(1)
			const nextSeq = (existing[0]?.seq ?? -1) + 1
			await tx.insert(schema.runEvents).values({
				runId,
				seq: nextSeq,
				kind,
				payload,
			})
		})
	})
}

/** @deprecated Use appendRunLifecycleEvent instead. */
export const appendTraceLifecycleEvent = appendRunLifecycleEvent

export function markRunComplete(
	query: QueryFn,
	runId: string,
	status: "completed" | "failed",
	metadata?: Record<string, unknown>,
): Effect.Effect<void, DbError> {
	return query((db) =>
		db
			.update(schema.runs)
			.set({
				status,
				metadata: metadata ?? undefined,
				completedAt: new Date(),
			})
			.where(eq(schema.runs.id, runId)),
	).pipe(Effect.asVoid)
}

/** @deprecated Use markRunComplete instead. */
export const markTraceComplete = markRunComplete
