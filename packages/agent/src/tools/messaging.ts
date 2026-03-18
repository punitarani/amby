import type { Database } from "@amby/db"
import { eq, schema } from "@amby/db"
import { tool } from "ai"
import { CronExpressionParser } from "cron-parser"
import { z } from "zod"

export type ReplyFn = (text: string) => Promise<void>

export function createReplyTools(sendReply: ReplyFn) {
	return {
		send_message: tool({
			description:
				"Send a message to the user immediately. Use for progress updates (casual, like 'one sec' or 'on it') or when you need to send multiple separate messages rather than one combined response.",
			inputSchema: z.object({
				text: z.string().describe("The message text to send"),
			}),
			execute: async ({ text }) => {
				await sendReply(text)
				return { sent: true }
			},
		}),
	}
}

export function createJobTools(db: Database, userId: string, userTimezone?: string) {
	return {
		schedule_job: tool({
			description:
				"Schedule something for the future — reminders, recurring checks, or deferred actions. Never mention 'job', 'cron', or 'scheduled task' to the user; confirm what you set up in plain language (e.g. 'I'll remind you Tuesday at 9am').",
			inputSchema: z.object({
				description: z.string().describe("What should happen when this job runs"),
				type: z.enum(["scheduled", "cron"]).describe("scheduled = one-time, cron = recurring"),
				runAt: z
					.string()
					.optional()
					.describe("ISO 8601 datetime for one-time jobs (e.g., 2026-03-15T15:00:00Z)"),
				schedule: z
					.string()
					.optional()
					.describe("Cron expression for recurring jobs (e.g., 0 8 * * * for daily 8am)"),
			}),
			execute: async ({ description, type, runAt, schedule }) => {
				let nextRunAt: Date | null = runAt ? new Date(runAt) : null
				if (type === "cron" && schedule) {
					const tz = userTimezone ?? "UTC"
					const interval = CronExpressionParser.parse(schedule, { tz })
					nextRunAt = interval.next().toDate()
				}

				const rows = await db
					.insert(schema.jobs)
					.values({
						userId,
						type,
						status: "active",
						runAt: runAt ? new Date(runAt) : null,
						schedule: schedule ?? null,
						nextRunAt,
						payload: { description, timezone: userTimezone ?? "UTC" },
					})
					.returning({ id: schema.jobs.id })

				const job = rows[0]
				if (!job) throw new Error("Failed to insert job")
				return { scheduled: true, jobId: job.id, type, runAt, schedule }
			},
		}),

		set_timezone: tool({
			description:
				"Set the user's timezone. Use IANA timezone format (e.g., America/New_York, Europe/London).",
			inputSchema: z.object({
				timezone: z.string().describe("IANA timezone identifier"),
			}),
			execute: async ({ timezone }) => {
				try {
					Intl.DateTimeFormat(undefined, { timeZone: timezone })
				} catch {
					return { updated: false, error: `Invalid IANA timezone identifier: ${timezone}` }
				}
				await db
					.update(schema.users)
					.set({ timezone, updatedAt: new Date() })
					.where(eq(schema.users.id, userId))
				return { updated: true, timezone }
			},
		}),
	}
}
