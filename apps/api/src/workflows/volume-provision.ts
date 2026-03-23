import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	createDaytonaClient,
	ensureProvisionableVolume,
	waitForVolumeReady,
} from "@amby/computer/sandbox-config"
import { DbService } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect } from "effect"
import { makeRuntimeForConsumer } from "../queue/runtime"
import { setWorkerScope } from "../sentry"

const VOLUME_READY_TIMEOUT_MS = 20 * 60 * 1000
const VOLUME_POLL_INTERVAL_MS = 1_000

export interface VolumeProvisionParams {
	userId: string
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
		const { userId } = event.payload
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
			volumeRow = await step.do(
				"wait-volume-ready",
				{
					timeout: "25 minutes",
					retries: { limit: 1, delay: "5 seconds", backoff: "exponential" },
				},
				async () => {
					const daytona = makeDaytona()
					const row = await withRuntime(
						Effect.gen(function* () {
							const { db } = yield* DbService
							return yield* Effect.tryPromise({
								try: () =>
									waitForVolumeReady(daytona, db, userId, isDev, {
										timeoutMs: VOLUME_READY_TIMEOUT_MS,
										pollIntervalMs: VOLUME_POLL_INTERVAL_MS,
									}),
								catch: (cause) =>
									new Error(
										`Failed while waiting for volume readiness: ${cause instanceof Error ? cause.message : String(cause)}`,
									),
							})
						}),
					)
					return { id: row.id, daytonaVolumeId: row.daytonaVolumeId, status: row.status }
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
