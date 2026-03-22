import { type LanguageModel, stepCountIs, ToolLoopAgent, type ToolSet, tool } from "ai"
import { z } from "zod"
import {
	type AgentConfig,
	type AgentTraceMetadata,
	createTelemetrySettings,
	type RequestTraceMetadata,
} from "../telemetry"
import {
	collectAllToolResultsForUserMessages,
	extractToolUserMessages,
} from "../utils/extract-tool-user-messages"
import { SUBAGENT_DEFS } from "./definitions"
import { resolveTools, type ToolGroups } from "./tool-groups"

export type SubagentTrace = {
	agentName: string
	steps: Array<{
		toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
		toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>
	}>
	durationMs: number
}

export type SubagentTraceStore = Map<string, SubagentTrace>

export function createSubagentTools(
	getModel: (id?: string) => LanguageModel,
	toolGroups: ToolGroups,
	sharedPromptContext: string,
	config: AgentConfig,
	requestTraceMetadata: RequestTraceMetadata,
): { tools: ToolSet; traceStore: SubagentTraceStore } {
	const tools: ToolSet = {}
	const traceStore: SubagentTraceStore = new Map()
	let invocationIndex = 0

	for (const def of SUBAGENT_DEFS) {
		if (def.name === "computer" && !toolGroups.cua) continue

		const subagentTools = resolveTools(def.toolKeys, toolGroups)
		if (def.toolKeys.length > 0 && Object.keys(subagentTools).length === 0) continue

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
			execute: async ({ task, context }, { abortSignal, toolCallId }) => {
				try {
					const startTime = Date.now()
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
						model: getModel(def.modelId),
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
					const userMessages = extractToolUserMessages(
						collectAllToolResultsForUserMessages(result) ?? result.toolResults,
					)

					const toolsUsed = (result.steps ?? []).flatMap((step) =>
						step.toolCalls.map((tc) => tc.toolName),
					)

					const base: Record<string, unknown> = { summary: result.text }
					if (toolsUsed.length > 0) base.toolsUsed = toolsUsed

					traceStore.set(toolCallId, {
						agentName: def.name,
						steps: (result.steps ?? []).map((step) => ({
							toolCalls: step.toolCalls.map((tc) => ({
								toolCallId: tc.toolCallId,
								toolName: tc.toolName,
								input: tc.input,
							})),
							toolResults: step.toolResults.map((tr) => ({
								toolCallId: tr.toolCallId,
								toolName: tr.toolName,
								output: tr.output,
							})),
						})),
						durationMs: Date.now() - startTime,
					})

					return userMessages ? { ...base, userMessages } : base
				} catch (error) {
					return {
						error: true,
						summary: `Failed to complete task: ${error instanceof Error ? error.message : String(error)}`,
					}
				}
			},
		})
	}

	return { tools: tools, traceStore }
}
