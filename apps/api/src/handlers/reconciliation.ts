import {
	ReconciliationDatabaseHealthError,
	runScheduledReconciliation,
	SandboxService,
} from "@amby/computer"
import { CoreError } from "@amby/core"
import { DbService } from "@amby/db"
import { EnvError } from "@amby/env"
import { getWorkerDatabaseModeHint, type WorkerBindings } from "@amby/env/workers"
import { computeNextCronRun } from "@amby/plugins"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"
import { setDatabaseScopeAttributes, setWorkerScope } from "../sentry"
import { TelegramSender } from "../telegram"

const hasTaggedCause = (error: unknown, tag: string): boolean => {
	if (error && typeof error === "object") {
		const tagged = error as { _tag?: string; cause?: unknown; message?: string }
		if (tagged._tag === tag) return true
		if (typeof tagged.message === "string" && tagged.message.includes(tag)) return true
		if (tagged.cause !== undefined) return hasTaggedCause(tagged.cause, tag)
	}
	if (error instanceof Error && error.cause !== undefined) {
		return hasTaggedCause(error.cause, tag)
	}
	return false
}

export async function handleScheduledReconciliation(env: WorkerBindings): Promise<void> {
	const scope = setWorkerScope("reconciliation.cron")
	const requestedMode = getWorkerDatabaseModeHint(env)
	setDatabaseScopeAttributes(scope, { mode: requestedMode })

	let rt: ReturnType<typeof makeRuntimeForConsumer> | undefined
	try {
		const runtime = makeRuntimeForConsumer(env)
		rt = runtime
		await runtime.runPromise(
			Effect.gen(function* () {
				const { db } = yield* DbService
				const sandbox = yield* SandboxService
				const telegram = yield* TelegramSender
				yield* Effect.tryPromise({
						try: () =>
							runScheduledReconciliation({
								db,
								ensureSandbox: (userId) => runtime.runPromise(sandbox.ensure(userId)),
								isDev: env.NODE_ENV !== "production",
								sendTelegram: async (chatId, text) => {
									await telegram.sendMessage(chatId, text)
							},
							computeNextCronRun,
						}),
					catch: (e) => {
						console.error("[ReconciliationCron]", e)
						return new CoreError({ message: "Scheduled reconciliation failed", cause: e })
					},
				})
			}),
		)
	} catch (error) {
		setDatabaseScopeAttributes(scope, {
			mode: requestedMode,
			failureStage:
				error instanceof EnvError || hasTaggedCause(error, "EnvError")
					? "config"
					: error instanceof CoreError &&
							  (error.cause instanceof ReconciliationDatabaseHealthError ||
									hasTaggedCause(error.cause, "ReconciliationDatabaseHealthError"))
						? "reconciliation_preflight"
						: "reconciliation_run",
		})
		throw error instanceof CoreError
			? error
			: new CoreError({ message: "Scheduled reconciliation failed", cause: error })
	} finally {
		await rt?.dispose()
	}
}
