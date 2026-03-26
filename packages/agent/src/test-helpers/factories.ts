import type { AgentRunConfig } from "../types/agent"
import type { ExecutionTask, ExecutionTaskResult } from "../types/execution"

export function makeTask(
	partial: Partial<ExecutionTask> & Pick<ExecutionTask, "id">,
): ExecutionTask {
	return {
		id: partial.id,
		rootTaskId: partial.rootTaskId ?? partial.id,
		parentTaskId: partial.parentTaskId,
		depth: partial.depth ?? 1,
		specialist: partial.specialist ?? "research",
		runnerKind: partial.runnerKind ?? "toolloop",
		mode: partial.mode ?? "parallel",
		input:
			partial.input ??
			({
				kind: "specialist",
				goal: partial.id,
			} as const),
		dependencies: partial.dependencies ?? [],
		inputBindings: partial.inputBindings ?? {},
		resourceLocks: partial.resourceLocks ?? [],
		mutates: partial.mutates ?? false,
		writesExternal: partial.writesExternal ?? false,
		requiresConfirmation: partial.requiresConfirmation ?? false,
		requiresValidation: partial.requiresValidation ?? false,
	}
}

export function makeResult(
	partial: Partial<ExecutionTaskResult> & Pick<ExecutionTaskResult, "taskId">,
): ExecutionTaskResult {
	return {
		taskId: partial.taskId,
		rootTaskId: partial.rootTaskId ?? partial.taskId,
		depth: partial.depth ?? 1,
		specialist: partial.specialist ?? "research",
		status: partial.status ?? "completed",
		summary: partial.summary ?? `Result for ${partial.taskId}`,
		data: partial.data,
		artifacts: partial.artifacts,
		issues: partial.issues,
		metrics: partial.metrics,
		runtimeData: partial.runtimeData,
		traceRef: partial.traceRef ?? { traceId: `trace-${partial.taskId}` },
		backgroundRef: partial.backgroundRef,
	}
}

export function makeAgentRunConfig(overrides?: Partial<AgentRunConfig>): AgentRunConfig {
	return {
		request: {
			requestId: "test",
			conversationId: "test",
			userId: "test",
			mode: "message",
			environment: "development",
			...overrides?.request,
		},
		modelPolicy: {
			defaultModelId: "test-model",
			lowLatencyModelId: "test-model",
			highReasoningModelId: "test-model",
			validatorModelId: "test-model",
			...overrides?.modelPolicy,
		},
		runtime: {
			sandboxEnabled: true,
			cuaEnabled: false,
			integrationEnabled: false,
			streamingEnabled: false,
			browserEnabled: true,
			...overrides?.runtime,
		},
		policy: {
			allowDirectAnswer: true,
			allowBackgroundTasks: true,
			allowMemoryWrites: true,
			allowExternalWrites: true,
			requireWriteConfirmation: true,
			maxDepth: 1,
			...overrides?.policy,
		},
		budgets: {
			maxConversationSteps: 8,
			maxSubagentStepsByKind: {},
			maxParallelAgents: 3,
			maxToolCallsPerRun: 32,
			...overrides?.budgets,
		},
		context: {
			sharedPromptContext: "",
			userTimezone: "UTC",
			...overrides?.context,
		},
		trace: {
			enabled: false,
			includeToolPayloads: false,
			includeContextEvents: false,
			...overrides?.trace,
		},
	}
}
