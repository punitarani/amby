import type { Database, TaskStatus } from "@amby/db"
import { and, eq, inArray, schema } from "@amby/db"
import { Data } from "effect"

export const RECONCILIATION_ACTIVE_TASK_STATUSES = ["preparing", "running"] as const satisfies readonly TaskStatus[]

export type ReconciliationDatabaseFailureCode = "schema_incompatible" | "unreachable"

export class ReconciliationDatabaseHealthError extends Data.TaggedError(
	"ReconciliationDatabaseHealthError",
)<{
	readonly code: ReconciliationDatabaseFailureCode
	readonly message: string
	readonly cause?: unknown
}> {}

const SCHEMA_ERROR_PATTERNS = [
	/\bcolumn\b.+\bdoes not exist\b/i,
	/\brelation\b.+\bdoes not exist\b/i,
	/\bno such column\b/i,
	/\bunknown column\b/i,
	/\bschema is incompatible\b/i,
]

const collectErrorMessages = (error: unknown, messages = new Set<string>()): Set<string> => {
	if (error instanceof Error) {
		if (error.message) messages.add(error.message)
		if ("cause" in error && error.cause !== undefined) {
			collectErrorMessages(error.cause, messages)
		}
		return messages
	}

	if (typeof error === "string" && error) {
		messages.add(error)
	}

	return messages
}

export const classifyReconciliationDatabaseFailure = (
	error: unknown,
): ReconciliationDatabaseFailureCode => {
	for (const message of collectErrorMessages(error)) {
		if (SCHEMA_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
			return "schema_incompatible"
		}
	}

	return "unreachable"
}

export async function loadActiveSandboxUserIds(db: Database): Promise<string[]> {
	const activeRows = await db
		.selectDistinct({ userId: schema.tasks.userId })
		.from(schema.tasks)
		.where(
			and(
				eq(schema.tasks.runtime, "sandbox"),
				inArray(schema.tasks.status, [...RECONCILIATION_ACTIVE_TASK_STATUSES]),
			),
		)

	return activeRows.map((row) => row.userId)
}

export async function runReconciliationDatabasePreflight(db: Database): Promise<string[]> {
	try {
		return await loadActiveSandboxUserIds(db)
	} catch (error) {
		const code = classifyReconciliationDatabaseFailure(error)
		throw new ReconciliationDatabaseHealthError({
			code,
			message:
				code === "schema_incompatible"
					? "Reconciliation database schema is incompatible with the current task query."
					: "Reconciliation database query is unreachable.",
			cause: error,
		})
	}
}
