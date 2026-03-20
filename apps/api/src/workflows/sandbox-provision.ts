import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	buildSandboxCreateParams,
	createDaytonaClient,
	isDuplicateSandboxNameError,
	persistSandboxFromInstance,
	sandboxName,
	tryGetSandboxByName,
} from "@amby/computer/sandbox-config"
import { DbService, eq, schema } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"
import { setWorkerScope } from "../sentry"

export interface SandboxProvisionParams {
	userId: string
}

export class SandboxProvisionWorkflow extends WorkflowEntrypoint<
	WorkerBindings,
	SandboxProvisionParams
> {
	async run(event: WorkflowEvent<SandboxProvisionParams>, step: WorkflowStep) {
		const { userId } = event.payload
		const scope = setWorkerScope("workflow.sandbox_provision", {
			workflow_instance_id: event.instanceId,
			user_id: userId,
		})
		scope.setUser({ id: userId })

		const isDev = this.env.NODE_ENV !== "production"
		const name = sandboxName(userId, isDev)
		const env = this.env

		const makeDaytona = () =>
			createDaytonaClient({
				apiKey: env.DAYTONA_API_KEY ?? "",
				apiUrl: env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
				target: env.DAYTONA_TARGET ?? "us",
			})

		/** Run an effect that needs DbService using a short-lived runtime */
		const withRuntime = async <T>(effect: Effect.Effect<T, unknown, DbService>) => {
			const runtime = makeRuntimeForConsumer(env)
			try {
				return await runtime.runPromise(effect)
			} finally {
				await runtime.dispose()
			}
		}

		// Step 1: If Daytona already has the sandbox, reconcile DB; otherwise clear stale rows
		const shouldSkip = await step.do("check-existing", { timeout: "30 seconds" }, async () => {
			const daytona = makeDaytona()
			const existing = await tryGetSandboxByName(daytona, name)
			if (existing) {
				await withRuntime(
					Effect.gen(function* () {
						const { db } = yield* DbService
						yield* Effect.tryPromise(() => persistSandboxFromInstance(db, userId, existing))
					}),
				)
				return true
			}

			const [record] = await withRuntime(
				Effect.gen(function* () {
					const { db } = yield* DbService
					return db
						.select({ status: schema.sandboxes.status })
						.from(schema.sandboxes)
						.where(eq(schema.sandboxes.userId, userId))
						.limit(1)
				}),
			)

			if (record?.status === "creating") {
				return true
			}

			if (record && record.status !== "error") {
				await withRuntime(
					Effect.gen(function* () {
						const { db } = yield* DbService
						yield* Effect.tryPromise(() =>
							db.delete(schema.sandboxes).where(eq(schema.sandboxes.userId, userId)),
						)
					}),
				)
			}

			return false
		})

		if (shouldSkip) {
			Sentry.logger.info("Sandbox already exists or provisioning in progress", {
				sandbox_name: name,
				user_id: userId,
			})
			return
		}

		// Step 2: Create the sandbox (record in DB for coordination)
		const sandboxId = await step.do(
			"create-sandbox",
			{
				timeout: "5 minutes",
				retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				const pre = await tryGetSandboxByName(daytona, name)
				if (pre) {
					await withRuntime(
						Effect.gen(function* () {
							const { db } = yield* DbService
							yield* Effect.tryPromise(() => persistSandboxFromInstance(db, userId, pre, "running"))
						}),
					)
					return pre.id
				}

				await withRuntime(
					Effect.gen(function* () {
						const { db } = yield* DbService
						return db
							.insert(schema.sandboxes)
							.values({
								userId,
								daytonaSandboxId: "pending",
								status: "creating" as const,
							})
							.onConflictDoUpdate({
								target: schema.sandboxes.userId,
								set: { status: "creating" as const, lastActivityAt: new Date() },
							})
					}),
				)

				const createSpec = buildSandboxCreateParams(userId, isDev)

				try {
					const sandbox = await daytona.create(createSpec, { timeout: 300 })
					await withRuntime(
						Effect.gen(function* () {
							const { db } = yield* DbService
							yield* Effect.tryPromise(() =>
								persistSandboxFromInstance(db, userId, sandbox, "running"),
							)
						}),
					)
					return sandbox.id
				} catch (cause) {
					if (isDuplicateSandboxNameError(cause)) {
						const recovered = await tryGetSandboxByName(daytona, name)
						if (recovered) {
							await withRuntime(
								Effect.gen(function* () {
									const { db } = yield* DbService
									yield* Effect.tryPromise(() =>
										persistSandboxFromInstance(db, userId, recovered, "running"),
									)
								}),
							)
							return recovered.id
						}
					}
					throw cause
				}
			},
		)

		// Step 3: Stop and archive so it starts fast later
		await step.do(
			"stop-and-archive",
			{
				timeout: "60 seconds",
				retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				const sandbox = await daytona.get(name)
				await sandbox.stop()
				await sandbox.archive()

				await withRuntime(
					Effect.gen(function* () {
						const { db } = yield* DbService
						yield* Effect.tryPromise(() =>
							persistSandboxFromInstance(db, userId, sandbox, "archived"),
						)
					}),
				)
			},
		)

		Sentry.logger.info("Sandbox provisioned", {
			sandbox_name: name,
			sandbox_id: sandboxId,
			user_id: userId,
		})
	}
}
