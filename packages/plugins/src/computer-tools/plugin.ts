import type { AmbyPlugin, ComputerProvider, PluginRegistry } from "@amby/core"
import { tool } from "ai"
import { Effect } from "effect"
import { z } from "zod"

export interface ComputerToolsPluginConfig {
	readonly computerProvider: ComputerProvider
}

export function createComputerToolsPlugin(config: ComputerToolsPluginConfig): AmbyPlugin {
	const { computerProvider } = config

	return {
		id: "computer-tools",

		register(registry: PluginRegistry) {
			registry.addToolProvider({
				id: "computer-tools:sandbox",
				group: "sandbox",
				getTools: async ({ userId, threadId }) => ({
					execute_in_sandbox: tool({
						description:
							"Execute a task in a durable sandbox environment. Use for code execution, file operations, long-running tasks, and anything that needs a persistent compute environment.",
						inputSchema: z.object({
							prompt: z.string().describe("What to execute in the sandbox"),
							requiresBrowser: z
								.boolean()
								.optional()
								.describe("Whether the task needs browser access"),
							instructions: z.string().optional().describe("Additional instructions for the task"),
						}),
						execute: async ({ prompt, requiresBrowser, instructions }) => {
							const result = await Effect.runPromise(
								computerProvider.startTask({
									prompt,
									userId,
									threadId,
									requiresBrowser,
									instructions,
								}),
							)
							return {
								taskId: result.taskId,
								status: result.status,
								summary: result.summary,
								error: result.error,
							}
						},
					}),

					query_sandbox_task: tool({
						description:
							"Check the status and results of a sandbox task that was previously started.",
						inputSchema: z.object({
							taskId: z.string().describe("The ID of the task to query"),
						}),
						execute: async ({ taskId }) => {
							const result = await Effect.runPromise(computerProvider.queryTask(taskId))
							return {
								taskId: result.taskId,
								status: result.status,
								summary: result.summary,
								output: result.output,
								artifacts: result.artifacts,
								error: result.error,
							}
						},
					}),
				}),
			})

			registry.addPlannerHintProvider({
				id: "computer-tools:hints",
				getHints: async () => {
					const available = await Effect.runPromise(computerProvider.isAvailable())
					return available
						? "Sandbox/computer capability is available for code execution, file operations, and long-running tasks in a persistent environment."
						: undefined
				},
			})
		},
	}
}
