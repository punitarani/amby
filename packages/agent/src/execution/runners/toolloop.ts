import { type LanguageModel, Output, stepCountIs, ToolLoopAgent, type ToolSet } from "ai"
import { Effect } from "effect"
import type { AgentRunConfig } from "../../types/agent"
import type {
	ExecutionTask,
	ExecutionTaskResult,
	SpecialistResultShape,
} from "../../types/execution"
import type { ArtifactRef, TaskIssue } from "../../types/persistence"
import type { TraceWriter } from "../ledger"
import { getSpecialistDefinition, resolveVisibleTools, type ToolGroups } from "../registry"

function buildPrompt(task: ExecutionTask): string {
	const parts = [
		`Task ID: ${task.id}`,
		`Goal: ${
			task.input.kind === "specialist"
				? task.input.goal
				: task.input.kind === "settings"
					? JSON.stringify(task.input.task)
					: JSON.stringify(task.input)
		}`,
	]
	if (task.input.kind === "specialist" && task.input.context) {
		parts.push(`Context:\n${task.input.context}`)
	}
	if (Object.keys(task.inputBindings).length > 0) {
		parts.push(`Dependency outputs:\n${JSON.stringify(task.inputBindings, null, 2)}`)
	}
	if (task.input.kind === "specialist" && task.input.payload !== undefined) {
		parts.push(`Structured payload:\n${JSON.stringify(task.input.payload, null, 2)}`)
	}
	return parts.join("\n\n")
}

function parseIssues(value: unknown): TaskIssue[] | undefined {
	if (!Array.isArray(value)) return undefined
	return value
		.filter(
			(item): item is { code: string; message: string; metadata?: Record<string, unknown> } =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as { code?: unknown }).code === "string" &&
				typeof (item as { message?: unknown }).message === "string",
		)
		.map((item) => ({
			code: item.code,
			message: item.message,
			metadata: item.metadata as Record<string, unknown> | undefined,
		}))
}

function parseArtifacts(value: unknown): ArtifactRef[] | undefined {
	if (!Array.isArray(value)) return undefined
	return value.filter(
		(item): item is ArtifactRef =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as { kind?: unknown }).kind === "string",
	)
}

function mapOutput(task: ExecutionTask, output: unknown, traceId: string): ExecutionTaskResult {
	const structured = (output ?? {}) as Partial<SpecialistResultShape> & {
		requiresEscalation?: boolean
	}
	const summary =
		typeof structured.summary === "string" && structured.summary.trim()
			? structured.summary.trim()
			: `${task.specialist} completed.`

	return {
		taskId: task.id,
		rootTaskId: task.rootTaskId,
		parentTaskId: task.parentTaskId,
		depth: task.depth,
		specialist: task.specialist,
		status: structured.requiresEscalation
			? "escalate"
			: structured.issues?.length
				? "partial"
				: "completed",
		summary,
		data: structured.data,
		artifacts: parseArtifacts(structured.artifacts) ?? structured.artifacts,
		issues: parseIssues(structured.issues) ?? structured.issues,
		traceRef: { traceId },
	}
}

export async function runToolloopSpecialist(params: {
	task: ExecutionTask
	config: AgentRunConfig
	getModel: (id?: string) => LanguageModel
	toolGroups: ToolGroups
	trace: TraceWriter
}): Promise<{
	result: ExecutionTaskResult
	toolEvents: Array<{ kind: "tool_call" | "tool_result"; payload: Record<string, unknown> }>
}> {
	const definition = getSpecialistDefinition(params.task.specialist)
	const tools = resolveVisibleTools(definition, params.config, params.toolGroups)
	const agent = new ToolLoopAgent({
		id: `specialist.${params.task.specialist}`,
		model: params.getModel(definition.selectModel(params.config)),
		instructions: definition.buildPrompt(params.config),
		tools: tools as ToolSet,
		output: Output.object({
			schema: definition.resultSchema,
			name: `${params.task.specialist}_result`,
		}),
		stopWhen: stepCountIs(definition.maxSteps(params.config)),
		experimental_onStepStart: async (event) => {
			await Effect.runPromise(
				params.trace.append("model_request", {
					stepNumber: event.stepNumber,
					activeTools: event.activeTools,
				}),
			)
		},
		onStepFinish: async (stepResult) => {
			await Effect.runPromise(
				params.trace.append("model_response", {
					finishReason: stepResult.finishReason,
					text: stepResult.text,
				}),
			)
		},
	})

	const result = await agent.generate({
		prompt: buildPrompt(params.task),
	})

	const toolEvents = (result.steps ?? []).flatMap((step) => [
		...step.toolCalls.map((toolCall) => ({
			kind: "tool_call" as const,
			payload: {
				toolCallId: toolCall.toolCallId,
				toolName: toolCall.toolName,
				input: toolCall.input,
			},
		})),
		...step.toolResults.map((toolResult) => ({
			kind: "tool_result" as const,
			payload: {
				toolCallId: toolResult.toolCallId,
				toolName: toolResult.toolName,
				output: toolResult.output,
			},
		})),
	])

	return {
		result: mapOutput(params.task, result.output, params.trace.traceId),
		toolEvents,
	}
}
