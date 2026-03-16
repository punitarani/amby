import type { Database } from "@amby/db"
import { schema } from "@amby/db"
import { tool } from "ai"
import { z } from "zod"

export type ReplyFn = (text: string) => Promise<void>

export function createReplyTools(sendReply: ReplyFn) {
	return {
		send_message: tool({
			description:
				"Send a message to the user immediately. Use this when you need to send multiple separate messages rather than one combined response.",
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

export function createJobTools(db: Database, userId: string) {
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
				const rows = await db
					.insert(schema.jobs)
					.values({
						userId,
						type,
						status: "active",
						runAt: runAt ? new Date(runAt) : null,
						schedule: schedule ?? null,
						nextRunAt: runAt ? new Date(runAt) : null,
						payload: { description },
					})
					.returning({ id: schema.jobs.id })

				const job = rows[0]
				if (!job) throw new Error("Failed to insert job")
				return { scheduled: true, jobId: job.id, type, runAt, schedule }
			},
		}),
	}
}
