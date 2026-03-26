import type { AutomationRepository } from "@amby/core"
import { tool } from "ai"
import { Effect } from "effect"
import { z } from "zod"

export type CronNextRunFn = (schedule: string, tz: string) => Date | undefined

export interface AutomationToolsConfig {
	readonly automationRepo: AutomationRepository
	readonly userId: string
	readonly userTimezone?: string
	/** Injected by the composition root (e.g. wrapping cron-parser). */
	readonly computeNextCronRun?: CronNextRunFn
	/** Resolved delivery target (e.g. { channel: "telegram", chatId }) for notifications. */
	readonly deliveryTarget?: Record<string, unknown>
}

export function createAutomationTools(config: AutomationToolsConfig) {
	const { automationRepo, userId, userTimezone, computeNextCronRun, deliveryTarget } = config

	return {
		schedule_automation: tool({
			description:
				"Schedule something for the future — reminders, recurring checks, or deferred actions. Never mention 'job', 'cron', or 'scheduled task' to the user; confirm what you set up in plain language (e.g. 'I'll remind you Tuesday at 9am').",
			inputSchema: z.object({
				description: z.string().describe("What should happen when this automation runs"),
				kind: z.enum(["scheduled", "cron"]).describe("scheduled = one-time, cron = recurring"),
				runAt: z.string().optional().describe("ISO 8601 datetime for one-time automations"),
				schedule: z
					.string()
					.optional()
					.describe("Cron expression for recurring automations (e.g., 0 8 * * * for daily 8am)"),
			}),
			execute: async ({ description, kind, runAt, schedule }) => {
				const tz = userTimezone ?? "UTC"
				let nextRunAt: Date | undefined

				if (kind === "scheduled" && runAt) {
					nextRunAt = new Date(runAt)
				} else if (kind === "cron" && schedule && computeNextCronRun) {
					nextRunAt = computeNextCronRun(schedule, tz)
				}

				const automation = await Effect.runPromise(
					automationRepo.create({
						userId,
						kind,
						status: "active",
						scheduleJson: { description, schedule, timezone: tz },
						nextRunAt,
						payloadJson: { description, timezone: tz },
						deliveryTargetJson: deliveryTarget ?? {},
					}),
				)

				return { scheduled: true, automationId: automation.id, kind, runAt, schedule }
			},
		}),

		list_automations: tool({
			description: "List the user's active scheduled tasks and recurring automations.",
			inputSchema: z.object({}),
			execute: async () => {
				const automations = await Effect.runPromise(
					automationRepo.findByUser(userId, { status: "active" }),
				)
				return automations.map((a) => ({
					id: a.id,
					kind: a.kind,
					status: a.status,
					schedule: a.scheduleJson,
					nextRunAt: a.nextRunAt?.toISOString(),
					lastRunAt: a.lastRunAt?.toISOString(),
				}))
			},
		}),

		cancel_automation: tool({
			description: "Cancel a scheduled automation by its ID.",
			inputSchema: z.object({
				automationId: z.string().describe("The ID of the automation to cancel"),
			}),
			execute: async ({ automationId }) => {
				await Effect.runPromise(automationRepo.delete(automationId))
				return { cancelled: true, automationId }
			},
		}),
	}
}
