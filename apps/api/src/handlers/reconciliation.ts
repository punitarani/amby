import { createDaytonaClient, reconcileTasks } from "@amby/computer"
import { DbService } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"

export async function handleReconciliation(env: WorkerBindings): Promise<void> {
	if (!env.DAYTONA_API_KEY) {
		return
	}

	const daytona = createDaytonaClient({
		apiKey: env.DAYTONA_API_KEY,
		apiUrl: env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
		target: env.DAYTONA_TARGET ?? "us",
	})

	const isDev = env.NODE_ENV !== "production"
	const runtime = makeRuntimeForConsumer(env)

	try {
		const { db } = await runtime.runPromise(
			Effect.gen(function* () {
				const svc = yield* DbService
				return { db: svc.db }
			}),
		)
		await reconcileTasks(db, daytona, isDev)
	} catch (e) {
		Sentry.captureException(e)
		console.error("[reconciliation] failed:", e)
	} finally {
		await runtime.dispose()
	}
}
