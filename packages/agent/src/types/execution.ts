import type { ExecutionMode, RunnerKind, SpecialistKind, TaskStatus } from "@amby/db"
import type { BrowserTaskInput, BrowserTaskResult } from "./browser"
import type { ArtifactRef, JsonObject, JsonValue, TaskIssue } from "./persistence"
import type { SettingsTaskInput } from "./settings"

export type ToolGroupKey =
	| "memory-read"
	| "memory-write"
	| "sandbox-read"
	| "sandbox-write"
	| "cua"
	| "integration"
	| "settings"

export type ExecutionTaskInput =
	| {
			kind: "specialist"
			goal: string
			context?: string
			expectedOutput?: string
			payload?: unknown
	  }
	| {
			kind: "browser"
			task: BrowserTaskInput
	  }
	| {
			kind: "settings"
			task: SettingsTaskInput
	  }
	| {
			kind: "background"
			prompt: string
			context?: string
			needsBrowser?: boolean
			instructions?: string
	  }

export type ExecutionTask = {
	id: string
	rootTaskId: string
	parentTaskId?: string
	depth: number
	spawnedBySpecialist?: SpecialistKind
	specialist: SpecialistKind
	runnerKind: RunnerKind
	mode: ExecutionMode
	input: ExecutionTaskInput
	dependencies: string[]
	inputBindings: Record<string, unknown>
	resourceLocks: string[]
	mutates: boolean
	writesExternal: boolean
	requiresConfirmation: boolean
	requiresValidation: boolean
}

export type ExecutionTaskMetrics = {
	steps?: number
	durationMs?: number
	inputTokens?: number
	outputTokens?: number
	reasoningTokens?: number
	cachedInputTokens?: number
	inferenceTimeMs?: number
}

export type ExecutionTaskResult = {
	taskId: string
	rootTaskId: string
	parentTaskId?: string
	depth: number
	specialist: SpecialistKind
	status: "completed" | "partial" | "failed" | "escalate"
	summary: string
	data?: JsonValue
	artifacts?: ArtifactRef[]
	issues?: TaskIssue[]
	metrics?: ExecutionTaskMetrics
	traceRef: { traceId: string }
	backgroundRef?: { taskId: string; traceId: string }
}

export type PlannedTask = Omit<ExecutionTask, "id" | "rootTaskId" | "depth">

export type ExecutionPlan = {
	strategy: ExecutionMode
	rationale: string
	tasks: PlannedTask[]
	reducer: "conversation" | "validator"
}

export type SpecialistResultShape = {
	summary: string
	data?: JsonValue
	artifacts?: ArtifactRef[]
	issues?: TaskIssue[]
}

export type QueryExecutionInput =
	| { kind: "by-id"; taskId: string; waitSeconds?: number }
	| { kind: "latest"; limit?: number; includeCompleted?: boolean }

export type QueryExecutionResult = {
	executions: Array<{
		taskId: string
		specialist: SpecialistKind | null
		status: TaskStatus
		summary: string | null
		traceId: string | null
		startedAt: string | null
		completedAt: string | null
		lastEventAt: string | null
		artifacts?: ArtifactRef[]
	}>
}

export type ExecutionReducerInput = {
	mode: ExecutionMode
	plan: ExecutionPlan
	taskResults: ExecutionTaskResult[]
	validatorResult?: ExecutionTaskResult
}

export type ExecutionSummary = {
	mode: ExecutionMode
	status: "completed" | "partial" | "failed"
	summary: string
	taskResults: ExecutionTaskResult[]
	backgroundTasks: Array<{ taskId: string; traceId: string; status: TaskStatus }>
	sideEffects: {
		memoriesSaved: string[]
		scheduledJobs: string[]
		externalWrites: string[]
	}
}

export type LockGraphState = {
	ready: ExecutionTask[]
	blocked: ExecutionTask[]
	inFlight: ExecutionTask[]
	completed: Map<string, ExecutionTaskResult>
}

export type SpecialistPromptContext = {
	sharedPromptContext: string
	userTimezone: string
}

export type SpecialistMetadata = {
	requestId: string
	conversationId: string
	threadId?: string
	userId: string
	rootTraceId: string
}

export type StructuredSpecialistResponse = {
	summary: string
	data?: JsonValue
	artifacts?: ArtifactRef[]
	issues?: TaskIssue[]
	requiresBackground?: boolean
	requiresEscalation?: boolean
}

export type ValidationVerdict = {
	ok: boolean
	summary: string
	issues?: TaskIssue[]
	data?: Record<string, unknown>
}

export type BrowserSpecialistResult = BrowserTaskResult
