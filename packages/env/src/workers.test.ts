import { describe, expect, it } from "bun:test"
import { EnvError } from "./shared"
import {
	resolveWorkerDatabaseConnection,
	type WorkerBindings,
} from "./workers"

const baseBindings = {
	OPENROUTER_API_KEY: "test-openrouter",
	BETTER_AUTH_SECRET: "test-secret",
} satisfies WorkerBindings

describe("resolveWorkerDatabaseConnection", () => {
	it("uses Hyperdrive when DB_CONNECTION_MODE=hyperdrive", () => {
		const resolved = resolveWorkerDatabaseConnection({
			...baseBindings,
			DB_CONNECTION_MODE: "hyperdrive",
			DATABASE_URL: "postgres://direct",
			HYPERDRIVE: { connectionString: "postgres://hyperdrive" },
		})

		expect(resolved).toEqual({
			mode: "hyperdrive",
			connectionString: "postgres://hyperdrive",
		})
	})

	it("uses DATABASE_URL when DB_CONNECTION_MODE=direct", () => {
		const resolved = resolveWorkerDatabaseConnection({
			...baseBindings,
			DB_CONNECTION_MODE: "direct",
			DATABASE_URL: "postgres://direct",
			HYPERDRIVE: { connectionString: "postgres://hyperdrive" },
		})

		expect(resolved).toEqual({
			mode: "direct",
			connectionString: "postgres://direct",
		})
	})

	it("defaults to direct mode when unset", () => {
		const resolved = resolveWorkerDatabaseConnection({
			...baseBindings,
			DATABASE_URL: "postgres://direct",
		})

		expect(resolved.mode).toBe("direct")
		expect(resolved.connectionString).toBe("postgres://direct")
	})

	it("fails fast when Hyperdrive mode is requested without the binding", () => {
		expect(() =>
			resolveWorkerDatabaseConnection({
				...baseBindings,
				DB_CONNECTION_MODE: "hyperdrive",
				DATABASE_URL: "postgres://direct",
			}),
		).toThrow(
			new EnvError({
				message: 'DB_CONNECTION_MODE="hyperdrive" requires the HYPERDRIVE binding.',
				code: "config",
			}),
		)
	})

	it("fails fast for invalid modes", () => {
		expect(() =>
			resolveWorkerDatabaseConnection({
				...baseBindings,
				DB_CONNECTION_MODE: "hybrid" as WorkerBindings["DB_CONNECTION_MODE"],
				DATABASE_URL: "postgres://direct",
			}),
		).toThrow(EnvError)
	})
})
