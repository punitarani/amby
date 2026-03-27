import type { AgentRunConfig } from "./types/agent"
import type { ExecutionRequestEnvelope, ExecutionResponseEnvelope } from "./types/persistence"

export type RunEnvironment = "development" | "production"

export type RequestRunMetadata = {
	request_id: string
	conversation_id: string
	request_mode: AgentRunConfig["request"]["mode"]
	environment: RunEnvironment
	source?: string
	telegram_batched?: boolean
	telegram_message_count?: number
}

export type AgentRunMetadata = RequestRunMetadata & {
	user_id: string
	model_id: string
	agent_role: "conversation" | "specialist"
	specialist_name?: string
	task_id?: string
}

export function normalizeRunEnvironment(value?: string | null): RunEnvironment {
	return value === "production" ? "production" : "development"
}

function extractRequestSourceMetadata(requestMetadata?: Record<string, unknown>) {
	const telegram =
		requestMetadata?.telegram &&
		typeof requestMetadata.telegram === "object" &&
		!Array.isArray(requestMetadata.telegram)
			? (requestMetadata.telegram as Record<string, unknown>)
			: undefined

	return {
		...(requestMetadata && Object.hasOwn(requestMetadata, "telegram") && { source: "telegram" }),
		...(typeof telegram?.batched === "boolean" && { telegram_batched: telegram.batched }),
		...(typeof telegram?.messageCount === "number" && {
			telegram_message_count: telegram.messageCount,
		}),
	}
}

export function buildRequestRunMetadata(request: AgentRunConfig["request"]): RequestRunMetadata {
	return {
		request_id: request.requestId,
		conversation_id: request.conversationId,
		request_mode: request.mode,
		environment: request.environment,
		...extractRequestSourceMetadata(request.metadata),
	}
}

export function buildAgentRunMetadata(params: {
	request: AgentRunConfig["request"]
	modelId: string
	agentRole: "conversation" | "specialist"
	specialistName?: string
	taskId?: string
}): AgentRunMetadata {
	return {
		...buildRequestRunMetadata(params.request),
		user_id: params.request.userId,
		model_id: params.modelId,
		agent_role: params.agentRole,
		...(params.specialistName ? { specialist_name: params.specialistName } : {}),
		...(params.taskId ? { task_id: params.taskId } : {}),
	}
}

export function buildRootRunMetadata(config: AgentRunConfig, extra?: Record<string, unknown>) {
	return {
		requestId: config.request.requestId,
		conversationId: config.request.conversationId,
		threadId: config.request.threadId ?? null,
		userId: config.request.userId,
		mode: config.request.mode,
		environment: config.request.environment,
		...extra,
	}
}

export function buildTaskRunMetadata(params: {
	request: AgentRunConfig["request"]
	executionRequest: ExecutionRequestEnvelope
	executionResponse?: ExecutionResponseEnvelope
	extra?: Record<string, unknown>
}): Record<string, unknown> {
	return {
		environment: params.request.environment,
		request: params.executionRequest as unknown as Record<string, unknown>,
		...(params.executionResponse
			? { response: params.executionResponse as unknown as Record<string, unknown> }
			: {}),
		...(params.extra ?? {}),
	}
}
