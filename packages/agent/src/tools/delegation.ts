import type { TaskSupervisor } from "@amby/computer"
import { tool } from "ai"
import type { Context } from "effect"
import { Effect } from "effect"
import { z } from "zod"

export function createSandboxDelegationTools(
	supervisor: Context.Tag.Service<typeof TaskSupervisor>,
	userId: string,
) {
	return {
		delegate_task: tool({
			description:
				"Delegate a task to a background agent running in the sandbox. " +
				"The agent runs autonomously with full computer access and optional browser automation. " +
				"Returns immediately with a taskId. Use get_task to check results — for long tasks, " +
				"check back on subsequent turns rather than waiting. " +
				"Use for: research, file creation, web scraping, data analysis, code generation, multi-step work.",
			inputSchema: z.object({
				prompt: z.string().describe("Detailed task description for the background agent"),
				needsBrowser: z
					.boolean()
					.optional()
					.default(false)
					.describe("Set true if the task requires web browsing (adds Playwright)"),
			}),
			execute: async ({ prompt, needsBrowser }) => {
				const result = await Effect.runPromise(
					supervisor.startTask({
						userId,
						prompt,
						needsBrowser,
					}),
				)
				return result
			},
		}),

		get_task: tool({
			description:
				"Check the current status of a delegated task. " +
				"Optionally wait briefly for completion with waitSeconds (max 15s). " +
				"For long-running tasks, check back on subsequent turns instead of waiting.",
			inputSchema: z.object({
				taskId: z.string().describe("Task ID from delegate_task"),
				waitSeconds: z
					.number()
					.optional()
					.describe("Seconds to wait for completion (max 15). Omit for immediate check."),
			}),
			execute: async ({ taskId, waitSeconds }) => {
				const task = await Effect.runPromise(supervisor.getTask(taskId, userId, waitSeconds))
				if (!task) return { error: "Task not found" }
				return {
					taskId: task.id,
					status: task.status,
					outputSummary: task.outputSummary,
					error: task.error,
					exitCode: task.exitCode,
					startedAt: task.startedAt?.toISOString(),
					completedAt: task.completedAt?.toISOString(),
				}
			},
		}),
	}
}
