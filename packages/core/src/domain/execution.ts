export type SpecialistKind =
	| "conversation"
	| "planner"
	| "research"
	| "builder"
	| "integration"
	| "computer"
	| "browser"
	| "memory"
	| "settings"
	| "validator"

export type RunnerKind = "toolloop" | "browser_service" | "background_handoff"

export type ExecutionMode = "direct" | "sequential" | "parallel" | "background"

export type RunStatus = "running" | "completed" | "failed"

export type RunEventKind =
	| "context_built"
	| "router_decision"
	| "skill_activated"
	| "planner_output"
	| "tool_call"
	| "tool_result"
	| "task_spawned"
	| "task_observed"
	| "model_request"
	| "model_response"
	| "error"
	| "completed"

export interface Run {
	readonly id: string
	readonly conversationId: string
	readonly threadId: string
	readonly triggerMessageId?: string
	readonly status: RunStatus
	readonly mode: ExecutionMode
	readonly modelId: string
	readonly summary?: string
	readonly requestJson?: unknown
	readonly responseJson?: unknown
	readonly startedAt: Date
	readonly completedAt?: Date
}

export interface RunEvent {
	readonly id: string
	readonly runId: string
	readonly seq: number
	readonly kind: RunEventKind
	readonly payload: Record<string, unknown>
	readonly createdAt: Date
}
