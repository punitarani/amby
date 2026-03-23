import type { BrowserService } from "@amby/browser"
import type { TaskSupervisor } from "@amby/computer"
import { tool } from "ai"
import type { Context } from "effect"
import { Effect } from "effect"
import { z } from "zod"

export type TaskTarget = "browser" | "computer" | "sandbox"

type BrowserTarget = {
	enabled: boolean
	runTask: Context.Tag.Service<typeof BrowserService>["runTask"]
}

type ComputerTarget = {
	enabled: boolean
	runTask: (params: {
		task: string
		context?: string
		abortSignal?: AbortSignal
		toolCallId: string
	}) => Promise<Record<string, unknown>>
}

function failure(target: TaskTarget, summary: string) {
	return {
		target,
		error: true,
		summary,
	}
}

export function getAvailableTaskTargets(options: {
	browserEnabled: boolean
	computerEnabled: boolean
	sandboxEnabled: boolean
}): [TaskTarget, ...TaskTarget[]] {
	const targets: TaskTarget[] = []
	if (options.browserEnabled) targets.push("browser")
	if (options.computerEnabled) targets.push("computer")
	if (options.sandboxEnabled) targets.push("sandbox")
	if (targets.length === 0) {
		throw new Error("delegate_task requires at least one enabled target")
	}
	return targets as [TaskTarget, ...TaskTarget[]]
}

function buildTargetDescription(targets: ReadonlyArray<TaskTarget>): string {
	return targets
		.map((target) =>
			target === "browser"
				? "browser = single-tab headless website work"
				: target === "computer"
					? "computer = Daytona desktop control"
					: "sandbox = long-running background Codex task",
		)
		.join(", ")
}

export function buildDelegateTaskDescription(options: {
	browserEnabled: boolean
	computerEnabled: boolean
	sandboxEnabled: boolean
}): string {
	const parts = ["Delegate work to one of Amby's execution targets."]

	if (options.browserEnabled) {
		parts.push(
			"Use target='browser' for headless single-tab website work via Stagehand on Cloudflare Browser Rendering.",
		)
	}

	if (options.computerEnabled) {
		parts.push(
			"Use target='computer' for Daytona CUA desktop interaction, native dialogs, uploads/downloads, CAPTCHA, MFA, or multi-tab browser behavior.",
		)
	}

	if (options.sandboxEnabled) {
		parts.push(
			"Use target='sandbox' for long-running autonomous background Codex tasks like extended research, file generation, or multi-step workflows.",
		)
		if (options.browserEnabled) {
			parts.push(
				"When target='browser' is available, use it for headless website work — do not use target='sandbox' with needsBrowser=true for that (sandbox always requires Codex auth).",
			)
		} else {
			parts.push(
				"When direct browser delegation is unavailable, sandbox tasks can still enable Playwright browser automation inside Codex with needsBrowser=true.",
			)
		}
	}

	parts.push(
		"Do not use for Composio tools like Gmail, Google Calendar, Notion, Slack, Google Drive, or other connected app tasks.",
	)

	return parts.join(" ")
}

export function createTaskDelegationTools(
	supervisor: Context.Tag.Service<typeof TaskSupervisor>,
	browser: BrowserTarget,
	computer: ComputerTarget,
	sandboxEnabled: boolean,
	userId: string,
	conversationId?: string,
) {
	const availableTargets = getAvailableTaskTargets({
		browserEnabled: browser.enabled,
		computerEnabled: computer.enabled,
		sandboxEnabled,
	})
	const tools = {
		delegate_task: tool({
			description: buildDelegateTaskDescription({
				browserEnabled: browser.enabled,
				computerEnabled: computer.enabled,
				sandboxEnabled,
			}),
			inputSchema: z
				.object({
					task: z.string().describe("Detailed task description for the selected execution target"),
					target: z.enum(availableTargets).describe(buildTargetDescription(availableTargets)),
					context: z
						.string()
						.optional()
						.describe("Additional context to append to the delegated task when helpful"),
					startUrl: z
						.string()
						.optional()
						.describe("Starting URL for browser tasks when you already know the page to open"),
					needsBrowser: z
						.boolean()
						.optional()
						.default(false)
						.describe(
							"Only for target='sandbox': request Playwright inside the Codex sandbox (requires Codex auth). If target='browser' is available, use that for website work instead of sandbox+needsBrowser.",
						),
				})
				.strict(),
			execute: async (
				{ task, target, context, startUrl, needsBrowser },
				{ abortSignal, toolCallId },
			) => {
				const fullTask = context ? `${task}\n\nAdditional context: ${context}` : task

				const runHeadlessBrowserTask = () =>
					Effect.runPromise(
						browser.runTask({ task: fullTask, startUrl }).pipe(
							Effect.map((result) => ({
								target: "browser" as const,
								...result,
							})),
							Effect.catchAll((error) =>
								Effect.succeed(
									failure(
										"browser",
										`Browser task failed: ${error.message || "Unknown browser error."}`,
									),
								),
							),
						),
					)

				if (target === "browser") {
					if (!browser.enabled) {
						return failure(
							"browser",
							'Headless browsing is not configured in this environment. Tell the user clearly — this chat cannot open live sites that way. Do not invent vague "blocked" or "tool" excuses.',
						)
					}

					return await runHeadlessBrowserTask()
				}

				if (target === "computer") {
					if (!computer.enabled) {
						return failure(
							"computer",
							"Desktop / computer control is not available in this environment. Say so plainly to the user.",
						)
					}

					try {
						const result = await computer.runTask({
							task,
							context,
							abortSignal,
							toolCallId,
						})
						return {
							target: "computer" as const,
							...result,
						}
					} catch (error) {
						return failure(
							"computer",
							`Computer task failed: ${error instanceof Error ? error.message : String(error)}`,
						)
					}
				}

				if (!sandboxEnabled) {
					return failure(
						"sandbox",
						"Background sandbox tasks are not available in this environment. Say that clearly to the user.",
					)
				}

				// Sandbox + needsBrowser is documented as a fallback when headless browser delegation
				// is unavailable; it still runs through Codex and requires auth. If browser is enabled,
				// run the headless path so website work does not fail with "Codex not configured".
				if ((needsBrowser ?? false) && browser.enabled) {
					return await runHeadlessBrowserTask()
				}

				const result = await Effect.runPromise(
					supervisor.startTask({
						userId,
						prompt: fullTask,
						needsBrowser: needsBrowser ?? false,
						conversationId,
					}),
				)
				return {
					target: "sandbox" as const,
					...result,
					summary: "Background task started.",
				}
			},
		}),
	}

	if (!sandboxEnabled) {
		return tools
	}

	return {
		...tools,

		get_task: tool({
			description:
				"Check the current status of a delegated task. " +
				"Optionally wait briefly for completion with waitSeconds (max 15s). " +
				"Use this only for tasks started with delegate_task target='sandbox'. Returns lastHeartbeat and lastEventSeq when available.",
			inputSchema: z.object({
				taskId: z.string().describe("Task ID from delegate_task when target was 'sandbox'"),
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
					lastHeartbeat: task.heartbeatAt?.toISOString(),
					lastEventSeq: task.lastEventSeq,
					lastProbeAt: task.lastProbeAt?.toISOString(),
				}
			},
		}),

		probe_task: tool({
			description:
				"Force a reconciliation of a delegated task with the sandbox: checks Daytona session state and status.json. " +
				"Use only for delegate_task target='sandbox' when a task seems stuck in running; not for routine polling.",
			inputSchema: z.object({
				taskId: z.string().describe("Task ID from delegate_task when target was 'sandbox'"),
			}),
			execute: async ({ taskId }) => {
				const task = await Effect.runPromise(supervisor.probeTask(taskId, userId))
				if (!task) return { error: "Task not found" }
				return {
					taskId: task.id,
					status: task.status,
					outputSummary: task.outputSummary,
					error: task.error,
					exitCode: task.exitCode,
					startedAt: task.startedAt?.toISOString(),
					completedAt: task.completedAt?.toISOString(),
					lastHeartbeat: task.heartbeatAt?.toISOString(),
					lastEventSeq: task.lastEventSeq,
					lastProbeAt: task.lastProbeAt?.toISOString(),
				}
			},
		}),

		get_task_artifacts: tool({
			description:
				"List artifact files for a delegate_task target='sandbox' task and optionally preview result.md (first 2000 chars).",
			inputSchema: z.object({
				taskId: z.string().describe("Task ID from delegate_task when target was 'sandbox'"),
			}),
			execute: async ({ taskId }) => {
				const result = await Effect.runPromise(supervisor.getTaskArtifacts(taskId, userId))
				if (!result) return { error: "Task not found" }
				return result
			},
		}),
	}
}
