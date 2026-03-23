import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	buildSandboxCreateParams,
	createDaytonaClient,
	ensureMountedHomeLayout,
	ensureVolume,
	inferDbStatusFromSandbox,
	isDuplicateSandboxNameError,
	sandboxHasExpectedVolume,
	sandboxName,
	tryGetSandboxByName,
	upsertMainSandboxRow,
	VOLUME_MOUNT_PATH,
} from "@amby/computer/sandbox-config"
import { and, DbService, eq, ne, schema } from "@amby/db"
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

		/** Run an effect that needs DbService using a short-lived runtime. */
		const withRuntime = async <T>(effect: Effect.Effect<T, unknown, DbService>) => {
			const runtime = makeRuntimeForConsumer(env)
			try {
				return await runtime.runPromise(effect)
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : String(cause)
				throw new Error(message)
			} finally {
				await runtime.dispose()
			}
		}

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

		const workflowStatus = (
			sandbox: Parameters<typeof inferDbStatusFromSandbox>[0],
		): Exclude<ReturnType<typeof inferDbStatusFromSandbox>, "deleted"> => {
			const status = inferDbStatusFromSandbox(sandbox)
			return status === "deleted" ? "error" : status
		}

		const loadMainSandboxStatus = async () =>
			withRuntime(
				Effect.gen(function* () {
					const { db } = yield* DbService
					return yield* Effect.tryPromise({
						try: () =>
							db
								.select({ status: schema.sandboxes.status })
								.from(schema.sandboxes)
								.where(
									and(
										eq(schema.sandboxes.userId, userId),
										eq(schema.sandboxes.role, "main"),
										ne(schema.sandboxes.status, "deleted"),
									),
								)
								.limit(1)
								.then((rows) => rows[0] ?? null),
						catch: (cause) =>
							new Error(
								`Failed to load sandbox row: ${cause instanceof Error ? cause.message : String(cause)}`,
							),
					})
				}),
			)

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
			return { id: row.id, daytonaVolumeId: row.daytonaVolumeId }
		})

		// Step 2: Ensure sandbox exists with the expected volume mount
		const sandboxState = await step.do(
			"ensure-sandbox",
			{
				timeout: "5 minutes",
				retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				const createSpec = {
					...buildSandboxCreateParams(userId, isDev),
					volumes: [{ volumeId: volumeRow.daytonaVolumeId, mountPath: VOLUME_MOUNT_PATH }],
				}

				const createFreshSandbox = async () => {
					const sandbox = await daytona.create(createSpec, { timeout: 300 })
					await upsertMainSandbox(sandbox.id, "running", volumeRow.id)
					return { sandboxId: sandbox.id, created: true }
				}

				const existing = await tryGetSandboxByName(daytona, name)
				if (existing) {
					await existing.refreshData()
					if (sandboxHasExpectedVolume(existing, volumeRow.daytonaVolumeId)) {
						await upsertMainSandbox(existing.id, workflowStatus(existing), volumeRow.id)
						return { sandboxId: existing.id, created: false }
					}

					console.warn("[SandboxProvision] Replacing legacy sandbox without expected volume", {
						sandboxId: existing.id,
						userId,
					})
					await existing.delete()
				}

				const record = await loadMainSandboxStatus()
				if (record?.status === "creating") {
					return { sandboxId: null, created: false }
				}

				await upsertMainSandbox("pending", "creating", volumeRow.id)

				try {
					return await createFreshSandbox()
				} catch (cause) {
					if (isDuplicateSandboxNameError(cause)) {
						const recovered = await tryGetSandboxByName(daytona, name)
						if (recovered) {
							await recovered.refreshData()
							if (!sandboxHasExpectedVolume(recovered, volumeRow.daytonaVolumeId)) {
								await recovered.delete()
								return await createFreshSandbox()
							}

							await upsertMainSandbox(recovered.id, workflowStatus(recovered), volumeRow.id)
							return { sandboxId: recovered.id, created: false }
						}
					}

					await upsertMainSandbox("pending", "error", volumeRow.id)
					throw cause
				}
			},
		)

		if (!sandboxState.sandboxId) {
			Sentry.logger.info("Sandbox provisioning already in progress", {
				sandbox_name: name,
				user_id: userId,
			})
			return
		}

		if (sandboxState.created) {
			// Step 3: Initialize the mounted home layout (idempotent)
			await step.do("init-volume-dirs", { timeout: "30 seconds" }, async () => {
				const daytona = makeDaytona()
				const sandbox = await daytona.get(name)
				await ensureMountedHomeLayout(sandbox)
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
		}

		Sentry.logger.info("Sandbox provisioned", {
			sandbox_name: name,
			sandbox_id: sandboxState.sandboxId,
			user_id: userId,
		})
	}
}
