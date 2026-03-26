import { describe, expect, it } from "bun:test"
import type { Database } from "@amby/db"
import {
	classifyReconciliationDatabaseFailure,
	loadActiveSandboxUserIds,
	ReconciliationDatabaseHealthError,
	runReconciliationDatabasePreflight,
} from "./reconciliation-health"

function makeActiveUserDb(userIds: string[]): Database {
	return {
		selectDistinct: () => ({
			from: () => ({
				where: async () => userIds.map((userId) => ({ userId })),
			}),
		}),
	} as unknown as Database
}

function makeFailingDb(error: Error): Database {
	return {
		selectDistinct: () => ({
			from: () => ({
				where: async () => {
					throw error
				},
			}),
		}),
	} as unknown as Database
}

describe("loadActiveSandboxUserIds", () => {
	it("returns active sandbox user ids from the reconciliation query", async () => {
		await expect(loadActiveSandboxUserIds(makeActiveUserDb(["u1", "u2"]))).resolves.toEqual([
			"u1",
			"u2",
		])
	})
})

describe("runReconciliationDatabasePreflight", () => {
	it("returns ok by resolving the active sandbox query", async () => {
		await expect(runReconciliationDatabasePreflight(makeActiveUserDb(["u1"]))).resolves.toEqual([
			"u1",
		])
	})

	it("classifies missing-column failures as schema incompatible", async () => {
		const error = new Error('column "runtime" does not exist')
		await expect(runReconciliationDatabasePreflight(makeFailingDb(error))).rejects.toEqual(
			new ReconciliationDatabaseHealthError({
				code: "schema_incompatible",
				message:
					"Reconciliation database schema is incompatible with the current task query.",
				cause: error,
			}),
		)
	})

	it("classifies other failures as unreachable", async () => {
		const error = new Error("connect ECONNREFUSED 127.0.0.1:5432")
		await expect(runReconciliationDatabasePreflight(makeFailingDb(error))).rejects.toEqual(
			new ReconciliationDatabaseHealthError({
				code: "unreachable",
				message: "Reconciliation database query is unreachable.",
				cause: error,
			}),
		)
	})
})

describe("classifyReconciliationDatabaseFailure", () => {
	it("checks nested causes for schema mismatch hints", () => {
		const nested = new Error("outer")
		nested.cause = new Error('relation "tasks" does not exist')

		expect(classifyReconciliationDatabaseFailure(nested)).toBe("schema_incompatible")
	})
})
