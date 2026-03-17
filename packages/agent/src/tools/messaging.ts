import type { Database } from "@amby/db"
import { eq, schema } from "@amby/db"
import { tool } from "ai"
import { CronExpressionParser } from "cron-parser"
import { z } from "zod"

export type ReplyFn = (text: string) => Promise<void>

/**
 * Creates the send_message tool definition WITHOUT an execute function.
 * This makes it a "client-side" tool: when the model calls it, the AI SDK
 * stops its internal loop and returns the tool call for manual execution.
 * The agent loop in agent.ts handles execution sequentially, ensuring
 * messages are delivered in order.
 */
export function createReplyToolDefs() {
	return {
		send_message: tool({
			description:
				"Send a message to the user immediately. Use for progress updates or when delivering content as multiple separate messages (e.g. counting, listing items individually). Can be called once per message — the agent loop ensures they arrive in order. After sending all content via send_message, keep your final text response empty or a brief confirmation.",
			inputSchema: z.object({
				text: z.string().describe("The message text to send"),
			}),
		}),
	}
}

export type SubAgentSpawner = (task: string, context?: string) => Promise<string>

export function createDelegationTools(spawnSubAgent: SubAgentSpawner) {
	return {
		delegate_task: tool({
			description: "Delegate a complex sub-task to a specialized sub-agent",
			inputSchema: z.object({
				task: z.string().describe("The sub-task to delegate"),
				context: z.string().optional().describe("Additional context for the sub-agent"),
			}),
			execute: async ({ task, context }) => {
				const result = await spawnSubAgent(task, context)
				return { completed: true, result }
			},
		}),
	}
}

export function createJobTools(db: Database, userId: string, userTimezone?: string) {
	return {
		schedule_job: tool({
			description:
				"Schedule a task for the future. Use for reminders, recurring checks, or deferred actions.",
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
