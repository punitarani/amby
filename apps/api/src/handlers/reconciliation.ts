import { TelegramSender } from "@amby/channels"
import { runScheduledReconciliation, SandboxService } from "@amby/computer"
import { CoreError } from "@amby/core"
import { DbService } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import { computeNextCronRun } from "@amby/plugins"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"

export async function handleScheduledReconciliation(env: WorkerBindings): Promise<void> {
	const rt = makeRuntimeForConsumer(env)
	try {
		await rt.runPromise(
			Effect.gen(function* () {
				const { db } = yield* DbService
				const sandbox = yield* SandboxService
				const telegram = yield* TelegramSender
				yield* Effect.tryPromise({
					try: () =>
						runScheduledReconciliation({
							db,
							ensureSandbox: (userId) => rt.runPromise(sandbox.ensure(userId)),
							isDev: env.NODE_ENV !== "production",
							sendTelegram: async (chatId, text) => {
								await telegram.sendMessage(chatId, text)
							},
							computeNextCronRun,
						}),
					catch: (e) => {
						console.error("[ReconciliationCron]", e)
						return new CoreError({ message: String(e) })
					},
				})
			}),
		)
	} finally {
		await rt.dispose()
	}
}
