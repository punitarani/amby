import { TelegramSender } from "@amby/channels"
import { runScheduledReconciliation, SandboxService } from "@amby/computer"
import { ComputeStore, CoreError, TaskStore, TraceStore } from "@amby/core"
import type { WorkerBindings } from "@amby/env/workers"
import { AutomationService, adaptAutomationService, computeNextCronRun } from "@amby/plugins"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"

export async function handleScheduledReconciliation(env: WorkerBindings): Promise<void> {
	const rt = makeRuntimeForConsumer(env)
	try {
		await rt.runPromise(
			Effect.gen(function* () {
				const taskStore = yield* TaskStore
				const traceStore = yield* TraceStore
				const computeStore = yield* ComputeStore
				const sandbox = yield* SandboxService
				const telegram = yield* TelegramSender
				const automationSvc = yield* AutomationService
				const automationRepo = adaptAutomationService(automationSvc)
				yield* Effect.tryPromise({
					try: () =>
						runScheduledReconciliation({
							taskStore,
							traceStore,
							computeStore,
							automationRepo,
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
