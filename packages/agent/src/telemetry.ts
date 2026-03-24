import { BraintrustSpanProcessor } from "@braintrust/otel"
import { type AttributeValue, context, type Tracer, trace } from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { BasicTracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace-base"
import type { TelemetrySettings } from "ai"
import { Effect } from "effect"

export type TraceRequestMode = "message" | "batched-message" | "stream-message"

export type RequestTraceMetadata = {
	request_id: string
	conversation_id: string
	request_mode: TraceRequestMode
	source?: string
	telegram_batched?: boolean
	telegram_message_count?: number
}

export type AgentTraceMetadata = RequestTraceMetadata & {
	user_id: string
	model_id: string
	agent_role: "conversation" | "specialist"
	specialist_name?: string
	task_id?: string
}

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

export const buildRequestTraceMetadata = ({
	requestId = crypto.randomUUID(),
	conversationId,
	requestMode,
	requestMetadata,
}: {
	requestId?: string
	conversationId: string
	requestMode: TraceRequestMode
	requestMetadata?: Record<string, unknown>
}): RequestTraceMetadata => {
	const telegram =
		requestMetadata?.telegram &&
		typeof requestMetadata.telegram === "object" &&
		!Array.isArray(requestMetadata.telegram)
			? (requestMetadata.telegram as Record<string, unknown>)
			: undefined

	return {
		request_id: requestId,
		conversation_id: conversationId,
		request_mode: requestMode,
		...(requestMetadata && Object.hasOwn(requestMetadata, "telegram") && { source: "telegram" }),
		...(typeof telegram?.batched === "boolean" && { telegram_batched: telegram.batched }),
		...(typeof telegram?.messageCount === "number" && {
			telegram_message_count: telegram.messageCount,
		}),
	}
}

export const createTelemetrySettings = ({
	functionId,
	metadata,
}: {
	functionId: string
	metadata: AgentTraceMetadata
}): TelemetrySettings => {
	if (!telemetryState?.enabled) {
		return { isEnabled: false }
	}

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
