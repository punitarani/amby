import type { ConversationMessagePart } from "@amby/core"
import type { ExecutionMode, SpecialistKind, TaskStatus } from "@amby/db"
import type { RunEnvironment } from "../run-metadata"
import type { ExecutionTaskResult } from "./execution"

export type AgentRunConfig = {
	request: {
		requestId: string
		conversationId: string
		threadId?: string
		userId: string
		mode: "message" | "batched-message" | "stream-message"
		environment: RunEnvironment
		metadata?: Record<string, unknown>
	}
	modelPolicy: {
		defaultModelId: string
		lowLatencyModelId?: string
		highReasoningModelId?: string
		routerModelId?: string
		validatorModelId?: string
	}
	runtime: {
		sandboxEnabled: boolean
		cuaEnabled: boolean
		integrationEnabled: boolean
		streamingEnabled: boolean
		browserEnabled: boolean
	}
	policy: {
		allowedAgents?: SpecialistKind[]
		allowedToolGroups?: string[]
		allowDirectAnswer: boolean
		allowBackgroundTasks: boolean
		allowMemoryWrites: boolean
		allowExternalWrites: boolean
		requireWriteConfirmation: boolean
		maxDepth: number
	}
	budgets: {
		maxConversationSteps: number
		maxSubagentStepsByKind: Partial<Record<SpecialistKind, number>>
		maxParallelAgents: number
		maxToolCallsPerRun: number
		maxLatencyMs?: number
	}
	context: {
		sharedPromptContext: string
		userTimezone: string
	}
	trace: {
		enabled: boolean
		includeToolPayloads: boolean
		includeContextEvents: boolean
	}
}

export type StreamPart =
	| { type: "text-delta"; text: string }
	| { type: "tool-call"; toolName: string; args: Record<string, unknown> }
	| { type: "tool-result"; toolName: string; result: unknown }

export type AgentRunResult = {
	status: "completed" | "partial" | "failed"
	userResponse: {
		text: string
		parts: ConversationMessagePart[]
		followups?: string[]
	}
	execution: {
		mode: ExecutionMode
		rootTraceId: string
		tasks: ExecutionTaskResult[]
		backgroundTasks?: Array<{ taskId: string; traceId: string; status: TaskStatus }>
	}
	sideEffects: {
		memoriesSaved?: string[]
		scheduledJobs?: string[]
		externalWrites?: string[]
	}
}
