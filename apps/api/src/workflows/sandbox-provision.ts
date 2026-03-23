import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	buildSandboxCreateParams,
	createDaytonaClient,
	DESKTOP_DIR,
	DOCUMENTS_DIR,
	DOWNLOADS_DIR,
	ensureVolume,
	isDuplicateSandboxNameError,
	sandboxName,
	startSandboxIfNeeded,
	tryGetSandboxByName,
	upsertMainSandboxRow,
	VOLUME_MOUNT_PATH,
} from "@amby/computer/sandbox-config"
import { DbService } from "@amby/db"
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

		/** Run an effect that needs DbService using a short-lived runtime.
		 *  Converts Effect FiberFailure to a plain Error so Cloudflare Workflows
		 *  can handle step failures without logging them as "Uncaught". */
		const withRuntime = async <T>(effect: Effect.Effect<T, unknown, DbService>) => {
			const runtime = makeRuntimeForConsumer(env)
			try {
				return await runtime.runPromise(effect)
			} catch (cause) {
				// Unwrap FiberFailure to a plain Error with a readable message
				const message = cause instanceof Error ? cause.message : String(cause)
				throw new Error(message)
			} finally {
				await runtime.dispose()
			}
		}

		/** Upsert main sandbox row via shared transactional helper */
		const upsertMainSandbox = async (
			daytonaSandboxId: string,
			status: "creating" | "running" | "stopped" | "archived" | "error",
			volId: string,
		) => {
			await withRuntime(
				Effect.gen(function* () {
					const { db } = yield* DbService
					yield* Effect.tryPromise({
						try: () => upsertMainSandboxRow(db, userId, daytonaSandboxId, status, volId),
						catch: (cause) =>
							new Error(
								`Failed to upsert sandbox row: ${cause instanceof Error ? cause.message : String(cause)}`,
							),
					})
				}),
			)
		}

		// Step 1: Ensure volume exists
		const volumeRow = await step.do("ensure-volume", { timeout: "30 seconds" }, async () => {
			const daytona = makeDaytona()
			const row = await withRuntime(
				Effect.gen(function* () {
					const { db } = yield* DbService
					return yield* Effect.tryPromise({
						try: () => ensureVolume(daytona, db, userId, isDev),
						catch: (cause) =>
							new Error(
								`Failed to ensure volume: ${cause instanceof Error ? cause.message : String(cause)}`,
							),
					})
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

		// Step 3: Initialize volume directory structure (idempotent)
		await step.do("init-volume-dirs", { timeout: "30 seconds" }, async () => {
			const daytona = makeDaytona()
			const sandbox = await daytona.get(name)
			await sandbox.process.executeCommand(
				`mkdir -p ${DESKTOP_DIR} ${DOCUMENTS_DIR} ${DOWNLOADS_DIR}`,
			)
		})

		// Step 4: Stop and archive so it starts fast later
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
