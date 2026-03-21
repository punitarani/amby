import { BraintrustSpanProcessor } from "@braintrust/otel"
import { type AttributeValue, context, type Tracer, trace } from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { BasicTracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace-base"
import type { TelemetrySettings } from "ai"
import { Effect } from "effect"

export type TraceRequestMode = "message" | "batched-message" | "stream-message"

type SharedTraceMetadataRequired = {
	request_id: string
	user_id: string
	conversation_id: string
	request_mode: TraceRequestMode
	message_count: number
	history_length: number
	tool_count: number
	model_id: string
	reply_tool_enabled: boolean
	cua_enabled: boolean
}

type SharedTraceMetadataOptional = Partial<{
	source: string
	telegram_batched: boolean
	telegram_message_count: number
}>

export type SharedTraceMetadata = SharedTraceMetadataRequired & SharedTraceMetadataOptional

type AgentTraceMetadataRequired = {
	agent_role: "orchestrator" | "subagent"
	agent_name: string
}

type AgentTraceMetadataOptional = Partial<{
	parent_agent_name: string
	delegation_tool: string
	agent_invocation_id: string
	agent_invocation_index: number
}>

export type AgentTraceMetadata = SharedTraceMetadata &
	AgentTraceMetadataRequired &
	AgentTraceMetadataOptional

type TraceAttributes = Record<string, AttributeValue | undefined>
type TelemetryInitOptions = {
	apiKey?: string
	projectId?: string
	spanProcessors?: SpanProcessor[]
}
type TelemetryState = {
	enabled: boolean
	tracer: Tracer
	provider?: BasicTracerProvider
	contextManager?: AsyncLocalStorageContextManager
}

let telemetryState: TelemetryState | undefined

const compactAttributes = <T extends TraceAttributes>(attributes: T) =>
	Object.fromEntries(
		Object.entries(attributes).filter(([, value]) => value !== undefined),
	) as Record<string, AttributeValue>

const buildBraintrustParent = (projectId?: string) => {
	const id = projectId?.trim()
	return id ? `project_id:${id}` : "project_name:Amby Agent"
}

const getRequestSourceMetadata = (metadata?: Record<string, unknown>) => {
	if (!metadata) return {}

	const telegram = metadata.telegram
	const telegramMetadata =
		telegram && typeof telegram === "object" && !Array.isArray(telegram)
			? (telegram as Record<string, unknown>)
			: undefined

	return compactAttributes({
		source: Object.hasOwn(metadata, "telegram") ? "telegram" : undefined,
		telegram_batched:
			typeof telegramMetadata?.batched === "boolean" ? telegramMetadata.batched : undefined,
		telegram_message_count:
			typeof telegramMetadata?.messageCount === "number"
				? telegramMetadata.messageCount
				: undefined,
	})
}

const getTelemetryState = () => telemetryState ?? initializeTelemetry()

export const initializeTelemetry = ({
	apiKey,
	projectId,
	spanProcessors,
}: TelemetryInitOptions = {}) => {
	if (telemetryState) return telemetryState

	const key = apiKey?.trim()
	const processors =
		spanProcessors ??
		(key
			? [
					new BraintrustSpanProcessor({
						apiKey: key,
						parent: buildBraintrustParent(projectId),
						filterAISpans: true,
					}),
				]
			: [])

	if (!key && !spanProcessors) {
		console.warn("[telemetry] BRAINTRUST_API_KEY not set - tracing disabled")
	}

	const provider =
		processors.length > 0 ? new BasicTracerProvider({ spanProcessors: processors }) : undefined
	const contextManager = new AsyncLocalStorageContextManager().enable()

	context.setGlobalContextManager(contextManager)
	if (provider) {
		trace.setGlobalTracerProvider(provider)
	}

	telemetryState = {
		enabled: provider !== undefined,
		provider,
		contextManager,
		tracer: (provider ?? trace.getTracerProvider()).getTracer("amby.agent.telemetry"),
	}

	return telemetryState
}

export const buildSharedTraceMetadata = ({
	requestId = crypto.randomUUID(),
	userId,
	conversationId,
	requestMode,
	messageCount,
	historyLength,
	toolCount,
	modelId,
	replyToolEnabled,
	cuaEnabled,
	requestMetadata,
}: {
	requestId?: string
	userId: string
	conversationId: string
	requestMode: TraceRequestMode
	messageCount: number
	historyLength: number
	toolCount: number
	modelId: string
	replyToolEnabled: boolean
	cuaEnabled: boolean
	requestMetadata?: Record<string, unknown>
}): SharedTraceMetadata =>
	({
		...compactAttributes({
			request_id: requestId,
			user_id: userId,
			conversation_id: conversationId,
			request_mode: requestMode,
			message_count: messageCount,
			history_length: historyLength,
			tool_count: toolCount,
			model_id: modelId,
			reply_tool_enabled: replyToolEnabled,
			cua_enabled: cuaEnabled,
		}),
		...getRequestSourceMetadata(requestMetadata),
	}) as SharedTraceMetadata

export const createOrchestratorTraceMetadata = (
	sharedTraceMetadata: SharedTraceMetadata,
): AgentTraceMetadata =>
	({
		...sharedTraceMetadata,
		...compactAttributes({
			agent_role: "orchestrator",
			agent_name: "orchestrator",
		}),
	}) as AgentTraceMetadata

export const createSubagentInvocationTracker = () => {
	let invocationIndex = 0

	return () => ({
		agent_invocation_id: crypto.randomUUID(),
		agent_invocation_index: (invocationIndex += 1),
	})
}

export const createSubagentTraceMetadata = (
	sharedTraceMetadata: SharedTraceMetadata,
	{
		agentName,
		parentAgentName,
		delegationTool,
		invocationId,
		invocationIndex,
	}: {
		agentName: string
		parentAgentName: string
		delegationTool: string
		invocationId: string
		invocationIndex: number
	},
): AgentTraceMetadata =>
	({
		...sharedTraceMetadata,
		...compactAttributes({
			agent_role: "subagent",
			agent_name: agentName,
			parent_agent_name: parentAgentName,
			delegation_tool: delegationTool,
			agent_invocation_id: invocationId,
			agent_invocation_index: invocationIndex,
		}),
	}) as AgentTraceMetadata

export const createTelemetrySettings = ({
	functionId,
	metadata,
}: {
	functionId: string
	metadata: AgentTraceMetadata
}): TelemetrySettings => {
	const { enabled, tracer } = getTelemetryState()

	if (!enabled) {
		return { isEnabled: false }
	}

	return {
		isEnabled: true,
		recordInputs: true,
		recordOutputs: true,
		functionId,
		metadata,
		tracer,
	}
}

export const forceFlushTelemetry = async () => {
	await telemetryState?.provider?.forceFlush()
}

const forceFlushTelemetryQuietly = Effect.tryPromise(() => forceFlushTelemetry()).pipe(
	Effect.catchAll((error) =>
		Effect.sync(() => {
			console.warn(
				`[telemetry] Failed to flush telemetry: ${error instanceof Error ? error.message : String(error)}`,
			)
		}),
	),
)

export const withTelemetryFlush = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(Effect.ensuring(forceFlushTelemetryQuietly))

export const shutdownTelemetry = async () => {
	const current = telemetryState
	telemetryState = undefined

	try {
		await current?.provider?.shutdown()
	} finally {
		current?.contextManager?.disable()
		trace.disable()
		context.disable()
	}
}

export const resetTelemetryForTests = async () => {
	await shutdownTelemetry()
}
