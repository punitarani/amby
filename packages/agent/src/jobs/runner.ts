/** Channel type for job delivery — telegram only after CLI removal. */
type ChannelType = "telegram"

import { and, DbService, eq, type JobStatus, lte, or, schema } from "@amby/db"
import { CronExpressionParser } from "cron-parser"
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
							channelType: "telegram" as ChannelType,
						})

						let nextStatus: JobStatus = job.type === "cron" ? "active" : "completed"
						let nextRunAt: Date | undefined
						if (job.type === "cron" && job.schedule) {
							const jobTz = ((job.payload as Record<string, unknown>)?.timezone as string) ?? "UTC"
							try {
								const interval = CronExpressionParser.parse(job.schedule, { tz: jobTz })
								nextRunAt = interval.next().toDate()
							} catch {
								// No future occurrences — treat as completed
								nextStatus = "completed"
							}
						}
						yield* query((db) =>
							db
								.update(schema.jobs)
								.set({
									status: nextStatus,
									lastRunAt: now,
									updatedAt: now,
									...(nextRunAt ? { nextRunAt } : {}),
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
