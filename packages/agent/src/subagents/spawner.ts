import { type LanguageModel, stepCountIs, ToolLoopAgent, type ToolSet, tool } from "ai"
import { z } from "zod"
import {
	type AgentConfig,
	type AgentTraceMetadata,
	createTelemetrySettings,
	type RequestTraceMetadata,
} from "../telemetry"
import { SUBAGENT_DEFS } from "./definitions"
import { resolveTools, type ToolGroups } from "./tool-groups"

export function createSubagentTools(
	model: LanguageModel,
	toolGroups: ToolGroups,
	sharedPromptContext: string,
	config: AgentConfig,
	requestTraceMetadata: RequestTraceMetadata,
): ToolSet {
	const tools: ToolSet = {}
	let invocationIndex = 0

	for (const def of SUBAGENT_DEFS) {
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
					const metadata: AgentTraceMetadata = {
						...requestTraceMetadata,
						user_id: config.userId,
						model_id: config.modelId,
						cua_enabled: config.cuaEnabled,
						agent_role: "subagent",
						agent_name: def.name,
						parent_agent_name: "orchestrator",
						delegation_tool: delegationToolName,
						agent_invocation_id: crypto.randomUUID(),
						agent_invocation_index: ++invocationIndex,
					}
					const subagent = new ToolLoopAgent({
						id: `subagent.${def.name}`,
						model,
						instructions: systemPrompt,
						tools: subagentTools,
						stopWhen: stepCountIs(def.maxSteps),
						experimental_telemetry: createTelemetrySettings({
							functionId: `amby.subagent.${def.name}.generate`,
							metadata,
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
