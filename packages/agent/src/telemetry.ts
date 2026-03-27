import { BraintrustSpanProcessor } from "@braintrust/otel"
import { type AttributeValue, context, type Tracer, trace } from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { BasicTracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace-base"
import type { TelemetrySettings } from "ai"
import { Effect } from "effect"
import { type AgentRunMetadata, buildAgentRunMetadata } from "./run-metadata"
import type { AgentRunConfig } from "./types/agent"

type TelemetryState = {
	enabled: boolean
	tracer: Tracer
	provider?: BasicTracerProvider
	contextManager?: AsyncLocalStorageContextManager
}

let telemetryState: TelemetryState | undefined

export const initializeTelemetry = ({
	apiKey,
	projectId,
	spanProcessors,
}: {
	apiKey?: string
	projectId?: string
	spanProcessors?: SpanProcessor[]
} = {}) => {
	if (telemetryState) return telemetryState

	const key = apiKey?.trim()
	const id = projectId?.trim()
	const processors =
		spanProcessors ??
		(key
			? [
					new BraintrustSpanProcessor({
						apiKey: key,
						parent: id ? `project_id:${id}` : "project_name:Amby Agent",
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

export const createTelemetrySettings = ({
	functionId,
	request,
	modelId,
	agentRole,
	specialistName,
	taskId,
}: {
	functionId: string
	request: AgentRunConfig["request"]
	modelId: string
	agentRole: AgentRunMetadata["agent_role"]
	specialistName?: string
	taskId?: string
}): TelemetrySettings => {
	if (!telemetryState?.enabled) {
		return { isEnabled: false }
	}

	const metadata = buildAgentRunMetadata({
		request,
		modelId,
		agentRole,
		specialistName,
		taskId,
	})

	return {
		isEnabled: true,
		recordInputs: true,
		recordOutputs: true,
		functionId,
		metadata: metadata as Record<string, AttributeValue>,
		tracer: telemetryState.tracer,
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
