import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	createDaytonaClient,
	ensureProvisionableVolume,
	mapVolumeStateToDbStatus,
	resolveHealthyVolume,
	upsertVolumeRow,
	volumeName,
} from "@amby/computer/sandbox-config"
import { DbService } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"
import { setWorkerScope } from "../sentry"

const MAX_VOLUME_POLLS = 240 // 240 × 5s = 20 minutes

export const VOLUME_READY_EVENT = "volume-provision-complete"

export interface VolumeProvisionParams {
	userId: string
	parentWorkflowId?: string
}

export interface VolumeProvisionResult {
	id: string
	daytonaVolumeId: string
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

		const withRuntime = async <T>(effect: Effect.Effect<T, unknown, DbService>) => {
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
						const { db } = yield* DbService
						return yield* Effect.tryPromise({
							try: () => ensureProvisionableVolume(daytona, db, userId, isDev),
							catch: (cause) =>
								new Error(
									`Failed to ensure provisionable volume: ${cause instanceof Error ? cause.message : String(cause)}`,
								),
						})
					}),
				)
				return { id: row.id, daytonaVolumeId: row.daytonaVolumeId, status: row.status }
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
								const { db } = yield* DbService
								return yield* Effect.tryPromise({
									try: () => upsertVolumeRow(db, userId, volume.id, status),
									catch: (cause) =>
										new Error(
											`Failed to upsert volume row: ${cause instanceof Error ? cause.message : String(cause)}`,
										),
								})
							}),
						)

						return { id: row.id, daytonaVolumeId: row.daytonaVolumeId, status: row.status }
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
							daytonaVolumeId: volumeRow.daytonaVolumeId,
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
			daytona_volume_id: volumeRow.daytonaVolumeId,
		})

		return {
			id: volumeRow.id,
			daytonaVolumeId: volumeRow.daytonaVolumeId,
			status: volumeRow.status,
		}
	}
}
