import {
	classifyReconciliationDatabaseFailure,
	ReconciliationDatabaseHealthError,
	runReconciliationDatabasePreflight,
} from "@amby/computer"
import { DbService } from "@amby/db"
import { DbConnectionMode, EnvError, EnvService } from "@amby/env"
import { Effect, type ManagedRuntime } from "effect"
import type { Context, Hono } from "hono"

export type DatabaseHealthFailureCode = "config" | "unreachable" | "schema_incompatible"

export type DatabaseHealthResponse =
	| { status: "ok"; database: { mode: DbConnectionMode } }
	| {
			status: "error"
			database: { mode: DbConnectionMode; code: DatabaseHealthFailureCode }
	  }

type RuntimeLike = Pick<ManagedRuntime.ManagedRuntime<any, any>, "runPromise">

const hasTaggedCause = (error: unknown, tag: string): boolean => {
	if (error && typeof error === "object") {
		const tagged = error as { _tag?: string; cause?: unknown }
		if (tagged._tag === tag) return true
		if (tagged.cause !== undefined) return hasTaggedCause(tagged.cause, tag)
	}
	if (error instanceof Error && error.cause !== undefined) {
		return hasTaggedCause(error.cause, tag)
	}
	return false
}

const inferDatabaseHealthCode = (error: unknown): DatabaseHealthFailureCode => {
	if (error instanceof EnvError || hasTaggedCause(error, "EnvError")) return "config"
	if (
		error instanceof ReconciliationDatabaseHealthError ||
		hasTaggedCause(error, "ReconciliationDatabaseHealthError")
	) {
		return classifyReconciliationDatabaseFailure(error)
	}
	if (classifyReconciliationDatabaseFailure(error) === "schema_incompatible") {
		return "schema_incompatible"
	}
	return "unreachable"
}

export const buildDatabaseHealthErrorResponse = (
	mode: DbConnectionMode,
	error: unknown,
): DatabaseHealthResponse => ({
	status: "error",
	database: {
		mode,
		code: inferDatabaseHealthCode(error),
	},
})

export async function checkDatabaseHealthWithRuntime(
	runtime: RuntimeLike,
	fallbackMode: DbConnectionMode,
): Promise<DatabaseHealthResponse> {
	let mode = fallbackMode

	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				const { db } = yield* DbService
				const env = yield* EnvService
				mode = env.DB_CONNECTION_MODE
				yield* Effect.promise(() => runReconciliationDatabasePreflight(db))
			}),
		)

		return { status: "ok", database: { mode } }
	} catch (error) {
		return buildDatabaseHealthErrorResponse(mode, error)
	}
}

export function registerHealthRoutes(
	app: Hono<any>,
	deps: {
		checkDatabase: (context: Context<any>) => Promise<DatabaseHealthResponse>
	},
) {
	app.get("/health", (c) => c.json({ status: "ok" }))
	app.get("/health/db", async (c) => {
		const response = await deps.checkDatabase(c)
		return c.json(response, response.status === "ok" ? 200 : 503)
	})
}
