import { type LanguageModel, stepCountIs, ToolLoopAgent, type ToolSet, tool } from "ai"
import { z } from "zod"
import {
	type AgentConfig,
	type AgentTraceMetadata,
	createTelemetrySettings,
	type RequestTraceMetadata,
} from "../telemetry"
import { extractToolUserMessages } from "../utils/extract-tool-user-messages"
import { type SubagentDef, SUBAGENT_DEFS } from "./definitions"
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

export type SubagentExecutionContext = {
	getModel: (id?: string) => LanguageModel
	toolGroups: ToolGroups
	sharedPromptContext: string
	config: AgentConfig
	requestTraceMetadata: RequestTraceMetadata
	traceStore: SubagentTraceStore
}

export async function runDelegatedSubagent(
	def: SubagentDef,
	execution: SubagentExecutionContext,
	params: {
		task: string
		context?: string
		abortSignal?: AbortSignal
		toolCallId: string
	},
): Promise<Record<string, unknown>> {
	const subagentTools = resolveTools(def.toolKeys, execution.toolGroups)
	if (def.toolKeys.length > 0 && Object.keys(subagentTools).length === 0) {
		return {
			error: true,
			summary: `${def.name} delegation is not available in this runtime.`,
		}
	}

	const systemPrompt = execution.sharedPromptContext
		? `${def.systemPrompt}\n\n# Context\n${execution.sharedPromptContext}`
		: def.systemPrompt
	const delegationToolName = `delegate_${def.name}` as const
	const startTime = Date.now()
	const metadata: AgentTraceMetadata = {
		...execution.requestTraceMetadata,
		user_id: execution.config.userId,
		model_id: execution.config.modelId,
		cua_enabled: execution.config.cuaEnabled,
		agent_role: "subagent",
		agent_name: def.name,
		parent_agent_name: "orchestrator",
		delegation_tool: delegationToolName,
		agent_invocation_id: crypto.randomUUID(),
		agent_invocation_index: execution.traceStore.size + 1,
	}
	const subagent = new ToolLoopAgent({
		id: `subagent.${def.name}`,
		model: execution.getModel(def.modelId),
		instructions: systemPrompt,
		tools: subagentTools,
		stopWhen: stepCountIs(def.maxSteps),
		experimental_telemetry: createTelemetrySettings({
			functionId: `amby.subagent.${def.name}.generate`,
			metadata,
		}),
	})
	const userMessage = params.context
		? `${params.task}\n\nAdditional context: ${params.context}`
		: params.task

	const result = await subagent.generate({
		prompt: userMessage,
		abortSignal: params.abortSignal,
	})
	const userMessages = extractToolUserMessages(result.toolResults)

	const toolsUsed = (result.steps ?? []).flatMap((step) => step.toolCalls.map((tc) => tc.toolName))

	const base: Record<string, unknown> = { summary: result.text }
	if (toolsUsed.length > 0) base.toolsUsed = toolsUsed

	execution.traceStore.set(params.toolCallId, {
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
}

export function createSubagentTools(
	getModel: (id?: string) => LanguageModel,
	toolGroups: ToolGroups,
	sharedPromptContext: string,
	config: AgentConfig,
	requestTraceMetadata: RequestTraceMetadata,
): { tools: ToolSet; traceStore: SubagentTraceStore } {
	const tools: ToolSet = {}
	const traceStore: SubagentTraceStore = new Map()
	const execution: SubagentExecutionContext = {
		getModel,
		toolGroups,
		sharedPromptContext,
		config,
		requestTraceMetadata,
		traceStore,
	}

	for (const def of SUBAGENT_DEFS) {
		if (def.name === "computer") continue

		const subagentTools = resolveTools(def.toolKeys, toolGroups)
		if (def.toolKeys.length > 0 && Object.keys(subagentTools).length === 0) continue

		tools[`delegate_${def.name}` as const] = tool({
			description: def.description,
			inputSchema: z.object({
				task: z.string().describe("The task for this agent to execute"),
				context: z.string().optional().describe("Additional context relevant to the task"),
			}),
			execute: async ({ task, context }, { abortSignal, toolCallId }) => {
				try {
					return await runDelegatedSubagent(def, execution, {
						task,
						context,
						abortSignal,
						toolCallId,
					})
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
