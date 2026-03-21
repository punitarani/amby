import type { LanguageModel, ToolSet } from "ai"
import { z } from "zod"
import { stepCountIs, ToolLoopAgent, tool } from "../braintrust"
import { SUBAGENT_DEFS } from "./definitions"
import { resolveTools, type ToolGroups } from "./tool-groups"

const extractToolUserMessages = (toolResults: ReadonlyArray<{ output?: unknown } | undefined>) => {
	const messages: string[] = []
	const seen = new Set<string>()

	for (const toolResult of toolResults) {
		const output = toolResult?.output
		if (
			typeof output === "object" &&
			output !== null &&
			"userMessages" in output &&
			Array.isArray(output.userMessages) &&
			output.userMessages.every((message) => typeof message === "string" && message.trim())
		) {
			for (const message of output.userMessages) {
				if (seen.has(message)) continue
				seen.add(message)
				messages.push(message)
			}
		}
	}

	return messages.length > 0 ? messages : undefined
}

export function createSubagentTools(
	getModel: (id?: string) => LanguageModel,
	toolGroups: ToolGroups,
	sharedContext: string,
): ToolSet {
	const tools: ToolSet = {}

	for (const def of SUBAGENT_DEFS) {
		const subagentTools = resolveTools(def.toolKeys, toolGroups)
		if (def.toolKeys.length > 0 && Object.keys(subagentTools).length === 0) continue

		const systemPrompt = sharedContext
			? `${def.systemPrompt}\n\n# Context\n${sharedContext}`
			: def.systemPrompt
		const subagent = new ToolLoopAgent({
			model: getModel(def.modelId),
			instructions: systemPrompt,
			tools: subagentTools,
			stopWhen: stepCountIs(def.maxSteps),
		})

		tools[`delegate_${def.name}`] = tool({
			description: def.description,
			inputSchema: z.object({
				task: z.string().describe("The task for this agent to execute"),
				context: z.string().optional().describe("Additional context relevant to the task"),
			}),
			execute: async ({ task, context }, { abortSignal }) => {
				try {
					const userMessage = context ? `${task}\n\nAdditional context: ${context}` : task

					const result = await subagent.generate({ prompt: userMessage, abortSignal })
					const userMessages = extractToolUserMessages(result.toolResults)

					return userMessages ? { summary: result.text, userMessages } : { summary: result.text }
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
