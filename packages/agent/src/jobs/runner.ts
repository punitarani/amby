import type { ChannelType } from "@amby/channels"
import { and, DbService, eq, lte, or, schema } from "@amby/db"
import { Context, Effect, Layer } from "effect"
import type { AgentError } from "../errors"

export type JobExecutor = (job: {
	id: string
	userId: string
	payload: Record<string, unknown> | null
	channelType: ChannelType
}) => Effect.Effect<void, AgentError>

export class JobRunnerService extends Context.Tag("JobRunnerService")<
	JobRunnerService,
	{
		readonly start: (executor: JobExecutor) => Effect.Effect<void, AgentError>
		readonly stop: () => Effect.Effect<void>
	}
>() {}

export const JobRunnerServiceLive = Layer.effect(
	JobRunnerService,
	Effect.gen(function* () {
		const { query } = yield* DbService
		const state = { interval: null as ReturnType<typeof setInterval> | null }

		const poll = (executor: JobExecutor) =>
			Effect.gen(function* () {
				const now = new Date()

				yield* query((db) =>
					db
						.update(schema.jobs)
						.set({ status: "pending", updatedAt: now })
						.where(
							and(
								eq(schema.jobs.status, "active"),
								or(lte(schema.jobs.runAt, now), lte(schema.jobs.nextRunAt, now)),
							),
						),
				)

				const pendingJobs = yield* query((db) =>
					db.select().from(schema.jobs).where(eq(schema.jobs.status, "pending")),
				)

				for (const job of pendingJobs) {
					yield* Effect.gen(function* () {
						yield* query((db) =>
							db
								.update(schema.jobs)
								.set({ status: "running", updatedAt: now })
								.where(eq(schema.jobs.id, job.id)),
						)

						yield* executor({
							id: job.id,
							userId: job.userId,
							payload: job.payload,
							channelType: job.channelType,
						})

						const nextStatus = job.type === "cron" ? "active" : "completed"
						yield* query((db) =>
							db
								.update(schema.jobs)
								.set({
									status: nextStatus,
									lastRunAt: now,
									updatedAt: now,
									...(job.type === "cron" && job.nextRunAt
										? { nextRunAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) }
										: {}),
								})
								.where(eq(schema.jobs.id, job.id)),
						)
					}).pipe(
						Effect.catchAll((err) =>
							query((db) =>
								db
									.update(schema.jobs)
									.set({ status: "failed", error: String(err), updatedAt: now })
									.where(eq(schema.jobs.id, job.id)),
							).pipe(Effect.ignoreLogged),
						),
					)
				}
			}).pipe(Effect.ignoreLogged)

		return {
			start: (executor) =>
				Effect.sync(() => {
					const runPoll = () => {
						Effect.runPromise(poll(executor)).catch(() => {})
					}
					state.interval = setInterval(runPoll, 60_000)
					runPoll()
				}),

			stop: () =>
				Effect.sync(() => {
					if (state.interval) {
						clearInterval(state.interval)
						state.interval = null
					}
				}),
		}
	}),
)
