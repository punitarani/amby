import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	AGENT_USER,
	AUTO_ARCHIVE_MINUTES,
	AUTO_STOP_MINUTES,
	createDaytonaClient,
	SANDBOX_RESOURCES,
	sandboxImage,
	sandboxLabels,
	sandboxName,
} from "@amby/computer/sandbox-config"
import { DbService, eq, schema } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"

export interface SandboxProvisionParams {
	userId: string
}

export class SandboxProvisionWorkflow extends WorkflowEntrypoint<
	WorkerBindings,
	SandboxProvisionParams
> {
	async run(event: WorkflowEvent<SandboxProvisionParams>, step: WorkflowStep) {
		const { userId } = event.payload
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

		// Step 1: Check if sandbox already exists
		const exists = await step.do("check-existing", { timeout: "30 seconds" }, async () => {
			// Check DB first
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
			if (record && record.status !== "error") return true

			// Also check Daytona directly
			try {
				await makeDaytona().get(name)
				return true
			} catch {
				return false
			}
		})

		if (exists) {
			console.log(`[SandboxProvision] Sandbox ${name} already exists, skipping`)
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

				const sandbox = await makeDaytona().create(
					{
						name,
						image: sandboxImage,
						resources: SANDBOX_RESOURCES,
						autoStopInterval: AUTO_STOP_MINUTES,
						autoArchiveInterval: AUTO_ARCHIVE_MINUTES,
						labels: sandboxLabels(userId, isDev),
						user: AGENT_USER,
					},
					{ timeout: 300 },
				)

				await withRuntime(
					Effect.gen(function* () {
						const { db } = yield* DbService
						return db
							.update(schema.sandboxes)
							.set({
								daytonaSandboxId: sandbox.id,
								status: "running" as const,
								lastActivityAt: new Date(),
							})
							.where(eq(schema.sandboxes.userId, userId))
					}),
				)

				return sandbox.id
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
				const sandbox = await makeDaytona().get(name)
				await sandbox.stop()
				await sandbox.archive()

				await withRuntime(
					Effect.gen(function* () {
						const { db } = yield* DbService
						return db
							.update(schema.sandboxes)
							.set({ status: "archived" as const, lastActivityAt: new Date() })
							.where(eq(schema.sandboxes.userId, userId))
					}),
				)
			},
		)

		console.log(`[SandboxProvision] Successfully provisioned sandbox ${name} (${sandboxId})`)
	}
}
