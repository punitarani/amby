import type { LanguageModel, ToolSet } from "ai"
import { z } from "zod"
import { generateText, stepCountIs, tool } from "../braintrust"
import { SUBAGENT_DEFS } from "./definitions"
import { resolveTools, type ToolGroups } from "./tool-groups"

export function createSubagentTools(
	model: LanguageModel,
	toolGroups: ToolGroups,
	sharedContext: string,
): ToolSet {
	const tools: ToolSet = {}

	for (const def of SUBAGENT_DEFS) {
		// Skip CUA subagent if no CUA tools available
		if (def.name === "computer" && !toolGroups.cua) continue

		const subagentTools = resolveTools(def.toolKeys, toolGroups)
		const systemPrompt = sharedContext
			? `${def.systemPrompt}\n\n# Context\n${sharedContext}`
			: def.systemPrompt

		tools[`delegate_${def.name}`] = tool({
			description: def.description,
			inputSchema: z.object({
				task: z.string().describe("The task for this agent to execute"),
				context: z.string().optional().describe("Additional context relevant to the task"),
			}),
			execute: async ({ task, context }) => {
				try {
					const userMessage = context ? `${task}\n\nAdditional context: ${context}` : task

					const result = await generateText({
						model,
						system: systemPrompt,
						messages: [{ role: "user", content: userMessage }],
						tools: subagentTools,
						stopWhen: stepCountIs(def.maxSteps),
					})

					return { summary: result.text }
				} catch (error) {
					return {
						error: true,
						summary: `Failed to complete task: ${error instanceof Error ? error.message : String(error)}`,
					}
				}
			},
		})
	}

	return tools
}
