import { describe, expect, it } from "bun:test"
import { CoreError } from "@amby/core"
import { EnvError } from "@amby/env"
import type { WorkerBindings } from "@amby/env/workers"
import { handleScheduledReconciliation } from "./reconciliation"

describe("handleScheduledReconciliation", () => {
	it("preserves the original cause when configuration fails", async () => {
		try {
			await handleScheduledReconciliation({
				NODE_ENV: "production",
				OPENROUTER_API_KEY: "test-openrouter",
				BETTER_AUTH_SECRET: "test-secret",
				DB_CONNECTION_MODE: "hyperdrive",
			} satisfies WorkerBindings)
			throw new Error("Expected scheduled reconciliation to fail")
		} catch (error) {
			expect(error).toBeInstanceOf(CoreError)
			expect((error as CoreError).cause).toBeInstanceOf(EnvError)
			expect((error as CoreError).cause).toMatchObject({ code: "config" })
		}
	})
})
