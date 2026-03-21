import { type LanguageModel, stepCountIs, ToolLoopAgent, type ToolSet, tool } from "ai"
import { z } from "zod"
import {
	createSubagentInvocationTracker,
	createSubagentTraceMetadata,
	createTelemetrySettings,
	type SharedTraceMetadata,
} from "../telemetry"
import { SUBAGENT_DEFS } from "./definitions"
import { resolveTools, type ToolGroups } from "./tool-groups"

export function createSubagentTools(
	model: LanguageModel,
	toolGroups: ToolGroups,
	sharedPromptContext: string,
	sharedTraceMetadata: SharedTraceMetadata,
): ToolSet {
	const tools: ToolSet = {}
	const nextInvocation = createSubagentInvocationTracker()

	for (const def of SUBAGENT_DEFS) {
		// Skip CUA subagent if no CUA tools available
		if (def.name === "computer" && !toolGroups.cua) continue

		const subagentTools = resolveTools(def.toolKeys, toolGroups)
		const systemPrompt = sharedPromptContext
			? `${def.systemPrompt}\n\n# Context\n${sharedPromptContext}`
			: def.systemPrompt
		const delegationToolName = `delegate_${def.name}` as const

		tools[delegationToolName] = tool({
			description: def.description,
			inputSchema: z.object({
				task: z.string().describe("The task for this agent to execute"),
				context: z.string().optional().describe("Additional context relevant to the task"),
			}),
			execute: async ({ task, context }, { abortSignal }) => {
				try {
					const invocation = nextInvocation()
					const subagent = new ToolLoopAgent({
						id: `subagent.${def.name}`,
						model,
						instructions: systemPrompt,
						tools: subagentTools,
						stopWhen: stepCountIs(def.maxSteps),
						experimental_telemetry: createTelemetrySettings({
							functionId: `amby.subagent.${def.name}.generate`,
							metadata: createSubagentTraceMetadata(sharedTraceMetadata, {
								agentName: def.name,
								parentAgentName: "orchestrator",
								delegationTool: delegationToolName,
								invocationId: invocation.agent_invocation_id,
								invocationIndex: invocation.agent_invocation_index,
							}),
						}),
					})
					const userMessage = context ? `${task}\n\nAdditional context: ${context}` : task

					const result = await subagent.generate({ prompt: userMessage, abortSignal })

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
