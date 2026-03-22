import type { TaskSupervisor } from "@amby/computer"
import { tool } from "ai"
import type { Context } from "effect"
import { Effect } from "effect"
import { z } from "zod"
import { buildCodexDeviceSignInUserMessages } from "./codex-sign-in-messages"

type Supervisor = Context.Tag.Service<typeof TaskSupervisor>

async function ensureCodexAuthForDelegation(supervisor: Supervisor, userId: string) {
	const auth = await Effect.runPromise(supervisor.getCodexAuthStatus(userId))

	if (auth.status === "authenticated" && auth.method) {
		return { ok: true as const }
	}

	if (auth.status === "pending" && auth.pending?.type === "device_code") {
		return {
			ok: false as const,
			userMessages: buildCodexDeviceSignInUserMessages(auth.pending.userCode),
		}
	}

	try {
		const afterStart = await Effect.runPromise(supervisor.startCodexChatgptAuth(userId))
		if (afterStart.status === "pending" && afterStart.pending?.type === "device_code") {
			return {
				ok: false as const,
				userMessages: buildCodexDeviceSignInUserMessages(afterStart.pending.userCode),
			}
		}
		if (afterStart.status === "authenticated" && afterStart.method) {
			return { ok: true as const }
		}
		return {
			ok: false as const,
			error:
				afterStart.error ??
				"Codex sign-in could not be started. Try again in a moment or use get_codex_auth_status.",
		}
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		return {
			ok: false as const,
			error: message,
		}
	}
}

export function createSandboxDelegationTools(
	supervisor: Context.Tag.Service<typeof TaskSupervisor>,
	userId: string,
	conversationId?: string,
) {
	return {
		delegate_task: tool({
			description:
				"Delegate a task to a background agent running in the sandbox. " +
				"The agent runs autonomously with full computer access and optional browser automation. " +
				"Returns immediately with a taskId. Amby will continue in the background and message you when the task completes (e.g. on Telegram). " +
				"Use get_task to check status, or probe_task to force a refresh from the sandbox. " +
				"Use for: research, file creation, web scraping, data analysis, code generation, multi-step work. " +
				"Do not use for Composio tools like Gmail, Google Calendar, Notion, Slack, Google Drive, or other connected app tasks.",
			inputSchema: z.object({
				prompt: z.string().describe("Detailed task description for the background agent"),
				needsBrowser: z
					.boolean()
					.optional()
					.default(false)
					.describe("Set true if the task requires web browsing (adds Playwright)"),
			}),
			execute: async ({ prompt, needsBrowser }) => {
				const ensured = await ensureCodexAuthForDelegation(supervisor, userId)
				if (!ensured.ok) {
					if ("userMessages" in ensured) {
						return {
							error: "codex_auth_required",
							status: "pending_setup",
							userMessages: ensured.userMessages,
						}
					}
					return {
						error: "codex_auth_failed",
						message: ensured.error,
					}
				}

				const result = await Effect.runPromise(
					supervisor.startTask({
						userId,
						prompt,
						needsBrowser,
						conversationId,
					}),
				)
				return result
			},
		}),

		get_task: tool({
			description:
				"Check the current status of a delegated task. " +
				"Optionally wait briefly for completion with waitSeconds (max 15s). " +
				"Returns lastHeartbeat and lastEventSeq when available.",
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
					lastHeartbeat: task.heartbeatAt?.toISOString(),
					lastEventSeq: task.lastEventSeq,
					lastProbeAt: task.lastProbeAt?.toISOString(),
				}
			},
		}),

		probe_task: tool({
			description:
				"Force a reconciliation of a delegated task with the sandbox: checks Daytona session state and status.json. " +
				"Use when a task seems stuck or stuck in running; not for routine polling.",
			inputSchema: z.object({
				taskId: z.string().describe("Task ID from delegate_task"),
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
				"List artifact files in a delegated task's output directory and optionally preview result.md (first 2000 chars).",
			inputSchema: z.object({
				taskId: z.string().describe("Task ID from delegate_task"),
			}),
			execute: async ({ taskId }) => {
				const result = await Effect.runPromise(supervisor.getTaskArtifacts(taskId, userId))
				if (!result) return { error: "Task not found" }
				return result
			},
		}),
	}
}
