import { runScheduledReconciliation, SandboxService } from "@amby/computer"
import { DbService } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"
import { TelegramSender } from "../telegram"

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
							ensureSandbox: (userId) => Effect.runPromise(sandbox.ensure(userId)),
							isDev: env.NODE_ENV !== "production",
							sendTelegram: async (chatId, text) => {
								await telegram.sendMessage(chatId, text)
							},
						}),
					catch: (e) => {
						console.error("[ReconciliationCron]", e)
					},
				})
			}),
		)
	} finally {
		await rt.dispose()
	}
}
