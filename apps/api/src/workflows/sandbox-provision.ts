import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	buildSandboxCreateParams,
	createDaytonaClient,
	ensureVolume,
	isDuplicateSandboxNameError,
	sandboxName,
	startSandboxIfNeeded,
	tryGetSandboxByName,
	VOLUME_MOUNT_PATH,
} from "@amby/computer/sandbox-config"
import { and, DbService, eq, schema } from "@amby/db"
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

		/** Upsert main sandbox row (find-then-update-or-insert for partial unique index) */
		const upsertMainSandbox = async (
			daytonaSandboxId: string,
			status: "creating" | "running" | "stopped" | "archived" | "error",
			volId: string,
		) => {
			await withRuntime(
				Effect.gen(function* () {
					const { db } = yield* DbService
					const rows = yield* Effect.tryPromise(() =>
						db
							.select({ id: schema.sandboxes.id })
							.from(schema.sandboxes)
							.where(and(eq(schema.sandboxes.userId, userId), eq(schema.sandboxes.role, "main")))
							.limit(1),
					)
					const existing = rows[0]
					if (existing) {
						yield* Effect.tryPromise(() =>
							db
								.update(schema.sandboxes)
								.set({
									daytonaSandboxId,
									status,
									volumeId: volId,
									lastActivityAt: new Date(),
									updatedAt: new Date(),
								})
								.where(eq(schema.sandboxes.id, existing.id)),
						)
					} else {
						yield* Effect.tryPromise(() =>
							db.insert(schema.sandboxes).values({
								userId,
								daytonaSandboxId,
								status,
								role: "main",
								volumeId: volId,
							}),
						)
					}
				}),
			)
		}

		// Step 1: Ensure volume exists
		const volumeRow = await step.do("ensure-volume", { timeout: "30 seconds" }, async () => {
			const daytona = makeDaytona()
			const row = await withRuntime(
				Effect.gen(function* () {
					const { db } = yield* DbService
					return yield* Effect.tryPromise(() => ensureVolume(daytona, db, userId, isDev))
				}),
			)
			// Serialize for step return (Cloudflare Workflows require JSON-serializable)
			return { id: row.id, daytonaVolumeId: row.daytonaVolumeId }
		})

		// Step 2: Ensure sandbox exists with volume mount
		const sandboxId = await step.do(
			"ensure-sandbox",
			{
				timeout: "5 minutes",
				retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()

				// Check if sandbox already exists
				const existing = await tryGetSandboxByName(daytona, name)
				if (existing) {
					await startSandboxIfNeeded(existing)
					await upsertMainSandbox(existing.id, "running", volumeRow.id)
					return existing.id
				}

				// Mark as creating
				await upsertMainSandbox("pending", "creating", volumeRow.id)

				const createSpec = {
					...buildSandboxCreateParams(userId, isDev),
					volumes: [{ volumeId: volumeRow.daytonaVolumeId, mountPath: VOLUME_MOUNT_PATH }],
				}

				try {
					const sandbox = await daytona.create(createSpec, { timeout: 300 })
					await upsertMainSandbox(sandbox.id, "running", volumeRow.id)
					return sandbox.id
				} catch (cause) {
					if (isDuplicateSandboxNameError(cause)) {
						const recovered = await tryGetSandboxByName(daytona, name)
						if (recovered) {
							await upsertMainSandbox(recovered.id, "running", volumeRow.id)
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
				await upsertMainSandbox(sandbox.id, "archived", volumeRow.id)
			},
		)

		Sentry.logger.info("Sandbox provisioned", {
			sandbox_name: name,
			sandbox_id: sandboxId,
			user_id: userId,
		})
	}
}
