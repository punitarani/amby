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
	waitForSandboxStarted,
} from "@amby/computer/sandbox-config"
import { DbService } from "@amby/db"
import type { WorkflowBinding, WorkflowInstanceStatus } from "@amby/env"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"
import { setWorkerScope } from "../sentry"
import type { VolumeProvisionParams, VolumeProvisionResult } from "./volume-provision"

const WORKFLOW_POLL_INTERVAL_MS = 1_000
const SANDBOX_READY_TIMEOUT_MS = 10 * 60 * 1000
const WORKFLOW_CHILD_TIMEOUT_MS = 25 * 60 * 1000

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function describeWorkflowFailure(status: WorkflowInstanceStatus): string {
	const reason = status.error?.message ?? status.error?.name
	return reason ? `${status.status}: ${reason}` : status.status
}

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
			daytonaSandboxId: string,
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

		const waitForWorkflowOutput = async <Output>(
			workflow: WorkflowBinding<VolumeProvisionParams>,
			workflowId: string,
			deadlineMs: number = WORKFLOW_CHILD_TIMEOUT_MS,
		): Promise<Output> => {
			const instance = await workflow.get(workflowId)
			const deadline = Date.now() + deadlineMs

			while (Date.now() < deadline) {
				const status = await instance.status()

				if (status.status === "complete") {
					return status.output as Output
				}

				if (status.status === "errored" || status.status === "terminated") {
					throw new Error(`Child workflow ${workflowId} failed: ${describeWorkflowFailure(status)}`)
				}

				await wait(WORKFLOW_POLL_INTERVAL_MS)
			}

			throw new Error(`Child workflow ${workflowId} timed out after ${deadlineMs}ms`)
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
			await upsertMainSandbox("pending", "volume_creating", volumeRow.id)
			const volumeWorkflow = env.VOLUME_WORKFLOW
			if (!volumeWorkflow) {
				throw new Error("VOLUME_WORKFLOW binding is not configured.")
			}

			const volumeWorkflowId = await step.do("start-volume-workflow", async () => {
				const instance = await volumeWorkflow.create({ params: { userId } })
				return instance.id
			})

			volumeRow = await step.do(
				"wait-volume-workflow",
				{
					timeout: "25 minutes",
					retries: { limit: 1, delay: "5 seconds", backoff: "exponential" },
				},
				async () => {
					const output = await waitForWorkflowOutput<VolumeProvisionResult>(
						volumeWorkflow,
						volumeWorkflowId,
					)
					if (output.status !== "ready") {
						throw new Error(`Volume workflow completed with unexpected status ${output.status}.`)
					}
					return output
				},
			)
		}

		const sandboxState = await step.do(
			"ensure-sandbox",
			{
				timeout: "15 minutes",
				retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				const createSpec = {
					...buildSandboxCreateParams(userId, isDev),
					volumes: [{ volumeId: volumeRow.daytonaVolumeId, mountPath: VOLUME_MOUNT_PATH }],
				}

				const ensureRunningSandbox = async (
					sandbox: Awaited<ReturnType<typeof tryGetSandboxByName>>,
					created: boolean,
				) => {
					if (!sandbox) {
						throw new Error("Expected sandbox instance but none was found.")
					}

					const readySandbox = await waitForSandboxStarted(sandbox, {
						timeoutMs: SANDBOX_READY_TIMEOUT_MS,
						pollIntervalMs: WORKFLOW_POLL_INTERVAL_MS,
					})
					await ensureMountedHomeLayout(readySandbox)
					await upsertMainSandbox(readySandbox.id, "running", volumeRow.id, COMPUTER_SNAPSHOT)
					return { sandboxId: readySandbox.id, created }
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
						return await ensureRunningSandbox(existing, false)
					}
				}

				await upsertMainSandbox("pending", "creating", volumeRow.id, COMPUTER_SNAPSHOT)

				const createFreshSandbox = async () => {
					const sandbox = await daytona.create(createSpec, { timeout: 300 })
					return await ensureRunningSandbox(sandbox, true)
				}

				try {
					return await createFreshSandbox()
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
								return await createFreshSandbox()
							}

							return await ensureRunningSandbox(recovered, false)
						}
					}

					await upsertMainSandbox("pending", "error", volumeRow.id)
					throw cause
				}
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
