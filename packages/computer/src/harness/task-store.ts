import {
	and,
	type Database,
	type DbError,
	desc,
	eq,
	lt,
	notInArray,
	schema,
	type TaskEventKind,
	type TaskEventSource,
	type TaskProvider,
	type TaskRuntime,
	type TaskStatus,
} from "@amby/db"
import { Effect } from "effect"
import { TERMINAL_STATUSES } from "./task-state"

export type TaskQueryFn = <T>(fn: (db: Database) => Promise<T>) => Effect.Effect<T, DbError>
export type TaskRecord = typeof schema.tasks.$inferSelect
export type TaskProgressKind = "task.started" | "task.progress" | "task.heartbeat"
export type TaskTerminalStatus =
	| "succeeded"
	| "partial"
	| "escalated"
	| "failed"
	| "timed_out"
	| "lost"
export type TaskRecordInsert = typeof schema.tasks.$inferInsert
export type TaskRecordUpdate = Partial<typeof schema.tasks.$inferInsert>

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export function mergeRuntimeData(
	current: unknown,
	patch: Record<string, unknown>,
): Record<string, unknown> | null {
	const merged = Object.fromEntries(
		Object.entries({
			...asRecord(current),
			...patch,
		}).filter(([, value]) => value !== undefined),
	)
	return Object.keys(merged).length > 0 ? merged : null
}

export function isSandboxTask(task: Pick<TaskRecord, "runtime" | "provider">): boolean {
	return task.runtime === "sandbox" && task.provider === "codex"
}

export function readTaskRuntimeData(
	task: Pick<TaskRecord, "runtimeData">,
): Record<string, unknown> {
	return asRecord(task.runtimeData)
}

export function readSandboxRuntimeData(task: Pick<TaskRecord, "runtime" | "runtimeData">): {
	authMode?: "api_key" | "chatgpt_account"
	sandboxId?: string
	sessionId?: string
	commandId?: string
	artifactRoot?: string
} | null {
	if (task.runtime !== "sandbox") return null
	const runtimeData = readTaskRuntimeData(task)
	return {
		authMode:
			runtimeData.authMode === "api_key" || runtimeData.authMode === "chatgpt_account"
				? runtimeData.authMode
				: undefined,
		sandboxId: typeof runtimeData.sandboxId === "string" ? runtimeData.sandboxId : undefined,
		sessionId: typeof runtimeData.sessionId === "string" ? runtimeData.sessionId : undefined,
		commandId: typeof runtimeData.commandId === "string" ? runtimeData.commandId : undefined,
		artifactRoot:
			typeof runtimeData.artifactRoot === "string" ? runtimeData.artifactRoot : undefined,
	}
}

export function deriveRuntimeForRunner(params: {
	runnerKind?: TaskRecord["runnerKind"]
	requiresBrowser?: boolean
}): {
	runtime: TaskRuntime
	provider: TaskProvider
	requiresBrowser: boolean
} {
	switch (params.runnerKind) {
		case "browser_service":
			return {
				runtime: "browser",
				provider: "stagehand",
				requiresBrowser: true,
			}
		case "background_handoff":
			return {
				runtime: "sandbox",
				provider: "codex",
				requiresBrowser: Boolean(params.requiresBrowser),
			}
		default:
			return {
				runtime: "in_process",
				provider: "internal",
				requiresBrowser: false,
			}
	}
}

export function mapExecutionResultStatus(
	status: "completed" | "partial" | "failed" | "escalate",
): TaskTerminalStatus {
	switch (status) {
		case "completed":
			return "succeeded"
		case "partial":
			return "partial"
		case "escalate":
			return "escalated"
		case "failed":
			return "failed"
	}
}

export function taskEventKindForTerminalStatus(status: TaskTerminalStatus): TaskEventKind {
	switch (status) {
		case "succeeded":
			return "task.completed"
		case "partial":
			return "task.partial"
		case "escalated":
			return "task.escalated"
		case "failed":
			return "task.failed"
		case "timed_out":
			return "task.timed_out"
		case "lost":
			return "task.lost"
	}
}

export function createTaskRecord(
	query: TaskQueryFn,
	params: TaskRecordInsert & {
		eventPayload?: Record<string, unknown>
	},
): Effect.Effect<void, DbError> {
	const { eventPayload, id, ...taskValues } = params
	const taskId = id ?? crypto.randomUUID()
	return query(async (db) => {
		const createdAt = new Date()
		await db.transaction(async (tx) => {
			await tx.insert(schema.tasks).values({
				...taskValues,
				id: taskId,
			})
			await tx.insert(schema.taskEvents).values({
				taskId,
				eventId: crypto.randomUUID(),
				source: "server",
				kind: "task.created",
				seq: null,
				payload: eventPayload ?? {},
				occurredAt: createdAt,
			})
		})
	})
}

export function updateTaskRecord(
	query: TaskQueryFn,
	taskId: string,
	patch: TaskRecordUpdate,
): Effect.Effect<void, DbError> {
	return query((db) => db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, taskId))).pipe(
		Effect.asVoid,
	)
}

export function appendTaskEvent(
	query: TaskQueryFn,
	params: {
		taskId: string
		eventId?: string
		source: TaskEventSource
		kind: TaskEventKind
		seq?: number | null
		payload?: Record<string, unknown>
		occurredAt?: Date
	},
): Effect.Effect<void, DbError> {
	return query((db) =>
		db.insert(schema.taskEvents).values({
			taskId: params.taskId,
			eventId: params.eventId ?? crypto.randomUUID(),
			source: params.source,
			kind: params.kind,
			seq: params.seq ?? null,
			payload: params.payload,
			occurredAt: params.occurredAt ?? new Date(),
		}),
	).pipe(Effect.asVoid)
}

export function appendTaskProgressEvent(
	query: TaskQueryFn,
	params: {
		taskId: string
		source?: Extract<TaskEventSource, "runtime" | "backend">
		kind?: TaskProgressKind
		seq: number
		payload?: Record<string, unknown>
		occurredAt?: Date
		status?: TaskStatus
	},
): Effect.Effect<boolean, DbError> {
	const occurredAt = params.occurredAt ?? new Date()
	return query(async (db) => {
		return await db.transaction(async (tx) => {
			const updated = await tx
				.update(schema.tasks)
				.set({
					...(params.status ? { status: params.status } : {}),
					lastEventSeq: params.seq,
					lastEventAt: occurredAt,
					heartbeatAt: occurredAt,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(schema.tasks.id, params.taskId),
						lt(schema.tasks.lastEventSeq, params.seq),
						notInArray(schema.tasks.status, TERMINAL_STATUSES),
					),
				)
				.returning({ id: schema.tasks.id })
			if (updated.length === 0) return false
			await tx.insert(schema.taskEvents).values({
				taskId: params.taskId,
				eventId: crypto.randomUUID(),
				source: params.source ?? "runtime",
				kind: params.kind ?? "task.progress",
				seq: params.seq,
				payload: params.payload,
				occurredAt,
			})
			return true
		})
	})
}

export function completeTaskRecord(
	query: TaskQueryFn,
	params: {
		taskId: string
		status: TaskTerminalStatus
		output?: unknown
		artifacts?: unknown
		summary: string
		error?: string | null
		exitCode?: number | null
		runtimeData?: Record<string, unknown> | null
		payload?: Record<string, unknown>
	},
): Effect.Effect<boolean, DbError> {
	const now = new Date()
	return query(async (db) => {
		return await db.transaction(async (tx) => {
			let nextRuntimeData: Record<string, unknown> | null | undefined
			if (params.runtimeData) {
				const currentRows = await tx
					.select({ runtimeData: schema.tasks.runtimeData })
					.from(schema.tasks)
					.where(eq(schema.tasks.id, params.taskId))
					.limit(1)
				nextRuntimeData = mergeRuntimeData(currentRows[0]?.runtimeData, params.runtimeData)
			}

			const updated = await tx
				.update(schema.tasks)
				.set({
					status: params.status,
					output: params.output,
					artifacts: params.artifacts,
					outputSummary: params.summary,
					error: params.error ?? undefined,
					exitCode: params.exitCode ?? undefined,
					completedAt: now,
					updatedAt: now,
					callbackSecretHash: null,
					...(nextRuntimeData !== undefined ? { runtimeData: nextRuntimeData } : {}),
				})
				.where(
					and(
						eq(schema.tasks.id, params.taskId),
						notInArray(schema.tasks.status, TERMINAL_STATUSES),
					),
				)
				.returning({ id: schema.tasks.id })
			if (updated.length === 0) return false

			await tx.insert(schema.taskEvents).values({
				taskId: params.taskId,
				eventId: crypto.randomUUID(),
				source: "server",
				kind: taskEventKindForTerminalStatus(params.status),
				seq: null,
				payload: params.payload ?? {
					status: params.status,
					summary: params.summary,
				},
				occurredAt: now,
			})
			return true
		})
	})
}

export function listRecentTaskEvents(
	query: TaskQueryFn,
	taskId: string,
	limit: number,
): Effect.Effect<(typeof schema.taskEvents.$inferSelect)[], DbError> {
	return query((db) =>
		db
			.select()
			.from(schema.taskEvents)
			.where(eq(schema.taskEvents.taskId, taskId))
			.orderBy(desc(schema.taskEvents.occurredAt), desc(schema.taskEvents.createdAt))
			.limit(limit),
	)
}
