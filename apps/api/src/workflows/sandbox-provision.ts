import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	buildSandboxCreateParams,
	COMPUTER_SNAPSHOT,
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
	volumeWorkflowId,
} from "@amby/computer/sandbox-config"
import { DbService } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"
import { setWorkerScope } from "../sentry"
import { VOLUME_READY_EVENT, type VolumeProvisionResult } from "./volume-provision"

const MAX_SANDBOX_POLLS = 200 // 200 × 3s = 10 minutes

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

		const env = this.env
		const isDev = env.NODE_ENV !== "production"
		const name = sandboxName(userId, isDev)

		const makeDaytona = () =>
			createDaytonaClient({
				apiKey: env.DAYTONA_API_KEY ?? "",
				apiUrl: env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
				target: env.DAYTONA_TARGET ?? "us",
			})

		const withRuntime = async <T>(effect: Effect.Effect<T, unknown, DbService>) => {
			const runtime = makeRuntimeForConsumer(env)
			try {
				return await runtime.runPromise(effect)
			} finally {
				await runtime.dispose()
			}
		}

		const upsertMainSandbox = async (
			daytonaSandboxId: string | null,
			status: "volume_creating" | "creating" | "running" | "stopped" | "archived" | "error",
			volumeId: string,
			snapshot?: string | null,
		) => {
			await withRuntime(
				Effect.gen(function* () {
					const { db } = yield* DbService
					yield* Effect.tryPromise({
						try: () =>
							upsertMainSandboxRow(db, userId, daytonaSandboxId, status, volumeId, snapshot),
						catch: (cause) =>
							new Error(
								`Failed to upsert sandbox row: ${cause instanceof Error ? cause.message : String(cause)}`,
							),
					})
				}),
			)
		}

		const deleteSandboxIfPresent = async (
			sandbox: Awaited<ReturnType<typeof tryGetSandboxByName>>,
		) => {
			if (!sandbox) return

			try {
				await sandbox.delete()
			} catch (cause) {
				if (
					cause instanceof Error &&
					(cause.message.includes("404") || cause.message.toLowerCase().includes("not found"))
				) {
					return
				}
				throw cause
			}
		}

		let volumeRow: VolumeProvisionResult = await step.do(
			"ensure-volume-record",
			{
				timeout: "30 seconds",
				retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				const row = await withRuntime(
					Effect.gen(function* () {
						const { db } = yield* DbService
						return yield* Effect.tryPromise({
							try: () => ensureVolume(daytona, db, userId, isDev),
							catch: (cause) =>
								new Error(
									`Failed to ensure volume row: ${cause instanceof Error ? cause.message : String(cause)}`,
								),
						})
					}),
				)
				return { id: row.id, daytonaVolumeId: row.daytonaVolumeId, status: row.status }
			},
		)

		if (volumeRow.status !== "ready") {
			await upsertMainSandbox(null, "volume_creating", volumeRow.id)
			const volumeWorkflow = env.VOLUME_WORKFLOW
			if (!volumeWorkflow) {
				throw new Error("VOLUME_WORKFLOW binding is not configured.")
			}

			await step.do("start-volume-workflow", async () => {
				await volumeWorkflow.create({
					id: volumeWorkflowId(userId),
					params: { userId, parentWorkflowId: event.instanceId },
				})
			})

			const volumeEvent = await step.waitForEvent<VolumeProvisionResult>("wait-volume-workflow", {
				type: VOLUME_READY_EVENT,
				timeout: "25 minutes",
			})
			volumeRow = volumeEvent.payload

			if (volumeRow.status !== "ready") {
				throw new Error(`Volume workflow completed with unexpected status ${volumeRow.status}.`)
			}
		}

		// Phase 1: Find or create the sandbox
		const sandboxInfo = await step.do(
			"ensure-sandbox",
			{
				timeout: "10 minutes",
				retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				const createSpec = {
					...buildSandboxCreateParams(userId, isDev),
					volumes: [{ volumeId: volumeRow.daytonaVolumeId, mountPath: VOLUME_MOUNT_PATH }],
				}

				const existing = await tryGetSandboxByName(daytona, name)
				if (existing) {
					await existing.refreshData()

					if (
						!sandboxHasExpectedVolume(existing, volumeRow.daytonaVolumeId) ||
						inferDbStatusFromSandbox(existing) === "error"
					) {
						console.warn("[SandboxProvision] Replacing stale sandbox", {
							sandboxId: existing.id,
							userId,
						})
						await deleteSandboxIfPresent(existing)
					} else {
						return { sandboxName: name, created: false }
					}
				}

				await upsertMainSandbox(null, "creating", volumeRow.id, COMPUTER_SNAPSHOT)

				try {
					await daytona.create(createSpec, { timeout: 300 })
					return { sandboxName: name, created: true }
				} catch (cause) {
					if (isDuplicateSandboxNameError(cause)) {
						const recovered = await tryGetSandboxByName(daytona, name)
						if (recovered) {
							await recovered.refreshData()

							if (
								!sandboxHasExpectedVolume(recovered, volumeRow.daytonaVolumeId) ||
								inferDbStatusFromSandbox(recovered) === "error"
							) {
								await deleteSandboxIfPresent(recovered)
								await daytona.create(createSpec, { timeout: 300 })
								return { sandboxName: name, created: true }
							}

							return { sandboxName: name, created: false }
						}
					}

					await upsertMainSandbox(null, "error", volumeRow.id)
					throw cause
				}
			},
		)

		// Phase 2: Poll for sandbox readiness using step-level loop
		for (let i = 0; i < MAX_SANDBOX_POLLS; i++) {
			if (i > 0) {
				await step.sleep(`sandbox-wait-${i}`, "3 seconds")
			}

			const state = await step.do(
				`check-sandbox-${i}`,
				{
					timeout: "30 seconds",
					retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
				},
				async () => {
					const daytona = makeDaytona()
					const sandbox = await tryGetSandboxByName(daytona, sandboxInfo.sandboxName)
					if (!sandbox) {
						throw new Error("Sandbox not found after creation.")
					}

					await sandbox.refreshData()

					if (sandbox.state === "started") return "started" as const
					if (sandbox.state === "stopped" || sandbox.state === "archived") {
						await sandbox.start()
						return "starting" as const
					}
					if (sandbox.state === "error" || sandbox.state === "build_failed") {
						return "error" as const
					}
					return "pending" as const
				},
			)

			if (state === "started") break
			if (state === "error") {
				throw new Error("Sandbox entered error state while waiting to start.")
			}

			if (i === MAX_SANDBOX_POLLS - 1) {
				throw new Error("Timed out waiting for sandbox to reach started state.")
			}
		}

		// Phase 3: Set up sandbox and persist state
		const sandboxState = await step.do(
			"setup-sandbox",
			{
				timeout: "2 minutes",
				retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				const sandbox = await tryGetSandboxByName(daytona, sandboxInfo.sandboxName)
				if (!sandbox) {
					throw new Error("Sandbox not found during setup.")
				}

				await sandbox.refreshData()
				await ensureMountedHomeLayout(sandbox)
				await upsertMainSandbox(sandbox.id, "running", volumeRow.id, COMPUTER_SNAPSHOT)
				return { sandboxId: sandbox.id, created: sandboxInfo.created }
			},
		)

		Sentry.logger.info("Sandbox provisioned", {
			workflow_instance_id: event.instanceId,
			sandbox_name: name,
			sandbox_id: sandboxState.sandboxId,
			user_id: userId,
		})

		return sandboxState
	}
}
