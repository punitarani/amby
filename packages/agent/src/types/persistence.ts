export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export type ArtifactRef = {
	kind: string
	title?: string
	uri?: string
	metadata?: Record<string, unknown>
}

export type TaskIssue = {
	code: string
	message: string
	metadata?: Record<string, unknown>
}

export type ExecutionRequestEnvelope = {
	taskId: string
	rootTaskId: string
	parentTaskId?: string
	depth: number
	specialist: string
	runnerKind: string
	dependencies: string[]
	input: JsonValue
	resourceLocks: string[]
	mutates: boolean
	writesExternal: boolean
	requiresConfirmation: boolean
	requiresValidation: boolean
}

export type ExecutionResponseEnvelope = {
	taskId: string
	status: string
	summary: string
	data?: JsonValue
	artifacts?: ArtifactRef[]
	issues?: TaskIssue[]
	metrics?: Record<string, unknown>
	backgroundRef?: {
		taskId: string
		traceId: string
	}
}
