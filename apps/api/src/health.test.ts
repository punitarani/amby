import { describe, expect, it } from "bun:test"
import type { Database, DbError } from "@amby/db"
import { DbService } from "@amby/db"
import { type DbConnectionMode, type Env, EnvService } from "@amby/env"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { checkDatabaseHealthWithRuntime, registerHealthRoutes } from "./health"

function makeEnv(mode: DbConnectionMode): Env {
	return {
		NODE_ENV: "test",
		API_URL: "http://localhost:3001",
		APP_URL: "http://localhost:3000",
		CLOUDFLARE_AI_GATEWAY_BASE_URL: "",
		CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: "",
		OPENROUTER_API_KEY: "test-openrouter",
		OPENAI_API_KEY: "",
		CARTESIA_API_KEY: "",
		DAYTONA_API_KEY: "",
		DAYTONA_API_URL: "https://app.daytona.io/api",
		DAYTONA_TARGET: "us",
		TELEGRAM_BOT_TOKEN: "",
		TELEGRAM_BOT_USERNAME: "amby_bot",
		TELEGRAM_WEBHOOK_SECRET: "",
		TELEGRAM_API_BASE_URL: undefined,
		COMPOSIO_API_KEY: "",
		COMPOSIO_WEBHOOK_SECRET: "",
		COMPOSIO_AUTH_CONFIG_GMAIL: "",
		COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: "",
		COMPOSIO_AUTH_CONFIG_NOTION: "",
		COMPOSIO_AUTH_CONFIG_SLACK: "",
		COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: "",
		DATABASE_URL: "postgres://direct",
		DB_CONNECTION_MODE: mode,
		BETTER_AUTH_SECRET: "test-secret",
		BETTER_AUTH_URL: "http://localhost:3000",
		ENABLE_CUA: false,
		BRAINTRUST_API_KEY: "",
		BRAINTRUST_PROJECT_ID: "",
		POSTHOG_KEY: "",
		POSTHOG_HOST: "https://us.i.posthog.com",
		SANDBOX_WORKFLOW: undefined,
		VOLUME_WORKFLOW: undefined,
	}
}

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

function makeRuntime(mode: DbConnectionMode, db: Database) {
	return ManagedRuntime.make(
		Layer.mergeAll(
			Layer.succeed(DbService, {
				db,
				query: ((fn: (database: Database) => Promise<unknown>) =>
					Effect.tryPromise({
						try: () => fn(db),
						catch: (cause) => cause as DbError,
					})) as any,
			}),
			Layer.succeed(EnvService, makeEnv(mode)),
		),
	)
}

describe("checkDatabaseHealthWithRuntime", () => {
	it("returns ok when the reconciliation preflight succeeds", async () => {
		const runtime = makeRuntime("hyperdrive", makeActiveUserDb(["u1"]))
		try {
			await expect(checkDatabaseHealthWithRuntime(runtime, "direct")).resolves.toEqual({
				status: "ok",
				database: { mode: "hyperdrive" },
			})
		} finally {
			await runtime.dispose()
		}
	})

	it("classifies missing-column failures as schema incompatible", async () => {
		const runtime = makeRuntime("direct", makeFailingDb(new Error('column "runtime" does not exist')))
		try {
			await expect(checkDatabaseHealthWithRuntime(runtime, "direct")).resolves.toEqual({
				status: "error",
				database: {
					mode: "direct",
					code: "schema_incompatible",
				},
			})
		} finally {
			await runtime.dispose()
		}
	})

	it("classifies connectivity failures as unreachable", async () => {
		const runtime = makeRuntime("direct", makeFailingDb(new Error("connect ECONNREFUSED 127.0.0.1:5432")))
		try {
			await expect(checkDatabaseHealthWithRuntime(runtime, "direct")).resolves.toEqual({
				status: "error",
				database: {
					mode: "direct",
					code: "unreachable",
				},
			})
		} finally {
			await runtime.dispose()
		}
	})
})

describe("registerHealthRoutes", () => {
	it("returns 200 for healthy database checks", async () => {
		const app = new Hono()
		registerHealthRoutes(app, {
			checkDatabase: async () => ({
				status: "ok",
				database: { mode: "hyperdrive" },
			}),
		})

		const response = await app.request("http://localhost/health/db")
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			status: "ok",
			database: { mode: "hyperdrive" },
		})
	})

	it("returns 503 without leaking raw SQL or error messages", async () => {
		const app = new Hono()
		registerHealthRoutes(app, {
			checkDatabase: async () => ({
				status: "error",
				database: { mode: "direct", code: "schema_incompatible" },
			}),
		})

		const response = await app.request("http://localhost/health/db")
		expect(response.status).toBe(503)

		const body = await response.text()
		expect(body).toContain('"code":"schema_incompatible"')
		expect(body).not.toContain("select distinct")
		expect(body).not.toContain("does not exist")
	})
})
