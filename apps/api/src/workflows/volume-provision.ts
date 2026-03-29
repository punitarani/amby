import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	createDaytonaClient,
	ensureProvisionableVolume,
	mapVolumeStateToDbStatus,
	resolveHealthyVolume,
	upsertVolumeRow,
	volumeName,
} from "@amby/computer/sandbox-config"
import { ComputeStore, CoreError } from "@amby/core"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../runtime/worker-runtime"
import { setWorkerScope } from "../sentry"

const MAX_VOLUME_POLLS = 240 // 240 × 5s = 20 minutes

export const VOLUME_READY_EVENT = "volume-provision-complete"

export interface VolumeProvisionParams {
	userId: string
	parentWorkflowId?: string
}

export interface VolumeProvisionResult {
	id: string
	externalVolumeId: string
	status: "creating" | "ready" | "error" | "deleted"
}

export class VolumeProvisionWorkflow extends WorkflowEntrypoint<
	WorkerBindings,
	VolumeProvisionParams
> {
	async run(event: WorkflowEvent<VolumeProvisionParams>, step: WorkflowStep) {
		const { userId, parentWorkflowId } = event.payload
		const scope = setWorkerScope("workflow.volume_provision", {
			workflow_instance_id: event.instanceId,
			user_id: userId,
		})
		scope.setUser({ id: userId })

		const env = this.env
		const isDev = env.NODE_ENV !== "production"

		const makeDaytona = () =>
			createDaytonaClient({
				apiKey: env.DAYTONA_API_KEY ?? "",
				apiUrl: env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
				target: env.DAYTONA_TARGET ?? "us",
			})

		const withRuntime = async <T>(effect: Effect.Effect<T, unknown, ComputeStore>) => {
			const runtime = makeRuntimeForConsumer(env)
			try {
				return await runtime.runPromise(effect)
			} finally {
				await runtime.dispose()
			}
		}

		let volumeRow: VolumeProvisionResult = await step.do(
			"ensure-volume",
			{
				timeout: "30 seconds",
				retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				const row = await withRuntime(
					Effect.gen(function* () {
						const computeStore = yield* ComputeStore
						return yield* Effect.tryPromise({
							try: () => ensureProvisionableVolume(daytona, computeStore, userId, isDev),
							catch: (cause) =>
								new CoreError({
									message: `Failed to ensure provisionable volume: ${cause instanceof Error ? cause.message : String(cause)}`,
								}),
						})
					}),
				)
				return { id: row.id, externalVolumeId: row.externalVolumeId, status: row.status }
			},
		)

		if (volumeRow.status !== "ready") {
			const name = volumeName(userId, isDev)

			for (let i = 0; i < MAX_VOLUME_POLLS; i++) {
				if (i > 0) {
					await step.sleep(`volume-wait-${i}`, "5 seconds")
				}

				volumeRow = await step.do(
					`check-volume-${i}`,
					{
						timeout: "30 seconds",
						retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
					},
					async () => {
						const daytona = makeDaytona()
						const volume = await resolveHealthyVolume(daytona, name)
						const status = mapVolumeStateToDbStatus(volume.state)

						const row = await withRuntime(
							Effect.gen(function* () {
								const computeStore = yield* ComputeStore
								return yield* Effect.tryPromise({
									try: () => upsertVolumeRow(computeStore, userId, volume.id, status),
									catch: (cause) =>
										new CoreError({
											message: `Failed to upsert volume row: ${cause instanceof Error ? cause.message : String(cause)}`,
										}),
								})
							}),
						)

						return { id: row.id, externalVolumeId: row.externalVolumeId, status: row.status }
					},
				)

				if (volumeRow.status === "ready") break
				if (volumeRow.status === "error" || volumeRow.status === "deleted") {
					throw new Error(`Volume entered ${volumeRow.status} state during provisioning.`)
				}
			}

			if (volumeRow.status !== "ready") {
				throw new Error("Timed out waiting for volume readiness.")
			}
		}

		const sandboxWorkflow = env.SANDBOX_WORKFLOW
		if (parentWorkflowId && sandboxWorkflow) {
			await step.do(
				"notify-parent",
				{
					timeout: "10 seconds",
					retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
				},
				async () => {
					const parent = await sandboxWorkflow.get(parentWorkflowId)
					await parent.sendEvent({
						type: VOLUME_READY_EVENT,
						payload: {
							id: volumeRow.id,
							externalVolumeId: volumeRow.externalVolumeId,
							status: volumeRow.status,
						},
					})
				},
			)
		}

		Sentry.logger.info("Volume provisioned", {
			workflow_instance_id: event.instanceId,
			user_id: userId,
			volume_id: volumeRow.id,
			external_volume_id: volumeRow.externalVolumeId,
		})

		return {
			id: volumeRow.id,
			externalVolumeId: volumeRow.externalVolumeId,
			status: volumeRow.status,
		}
	}
}
