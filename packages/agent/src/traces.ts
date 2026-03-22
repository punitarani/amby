import { eq, schema } from "@amby/db"
import { Effect } from "effect"

const TOOL_OUTPUT_TRUNCATE = 500
const SUMMARY_TRUNCATE = 200

type QueryFn = <T>(
	fn: (db: import("@amby/db").Database) => Promise<T>,
) => Effect.Effect<T, import("@amby/db").DbError>

// --- Pure utility functions ---

export function extractTraceSummary(
	steps: ReadonlyArray<{
		toolCalls: ReadonlyArray<{ toolCallId: string; toolName: string; input: unknown }>
		toolResults: ReadonlyArray<{
			toolCallId: string
			toolName: string
			output: unknown
		}>
	}>,
): {
	toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>
	toolResults?: Array<{ toolCallId: string; toolName: string; output: unknown }>
} {
	const toolCalls = steps.flatMap((s) =>
		s.toolCalls.map((tc) => ({
			toolCallId: tc.toolCallId,
			toolName: tc.toolName,
			input: tc.input,
		})),
	)
	const toolResults = steps.flatMap((s) =>
		s.toolResults.map((tr) => ({
			toolCallId: tr.toolCallId,
			toolName: tr.toolName,
			output: summarizeToolOutput(tr.output),
		})),
	)
	return {
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		toolResults: toolResults.length > 0 ? toolResults : undefined,
	}
}

export function summarizeToolOutput(output: unknown): unknown {
	if (typeof output === "object" && output !== null && "summary" in output) {
		return output
	}
	if (typeof output === "string") {
		if (output.length <= TOOL_OUTPUT_TRUNCATE) return output
		const cutPoint = output.lastIndexOf(" ", TOOL_OUTPUT_TRUNCATE)
		const safePoint = cutPoint > TOOL_OUTPUT_TRUNCATE - 100 ? cutPoint : TOOL_OUTPUT_TRUNCATE
		return `${output.slice(0, safePoint)}…`
	}
	return output
}

export function formatToolAnnotation(toolResults: unknown[]): string {
	if (toolResults.length === 0) return ""
	const parts = toolResults.map((tr: unknown) => {
		if (typeof tr !== "object" || tr === null) return "unknown"
		const name = "toolName" in tr && typeof tr.toolName === "string" ? tr.toolName : "unknown"
		const output = "output" in tr ? tr.output : undefined
		const summary =
			typeof output === "object" &&
			output !== null &&
			"summary" in output &&
			typeof output.summary === "string"
				? output.summary.slice(0, SUMMARY_TRUNCATE)
				: ""
		return summary ? `${name}: ${summary}` : name
	})
	return `[Tools used: ${parts.join("; ")}]`
}

// --- DB persistence functions ---

export function createTrace(
	query: QueryFn,
	params: {
		conversationId: string
		threadId?: string
		messageId?: string
		parentTraceId?: string
		rootTraceId?: string
		agentName: string
	},
): Effect.Effect<string, import("@amby/db").DbError> {
	return query((d) =>
		d
			.insert(schema.traces)
			.values({
				conversationId: params.conversationId,
				threadId: params.threadId,
				messageId: params.messageId,
				parentTraceId: params.parentTraceId,
				rootTraceId: params.rootTraceId ?? undefined,
				agentName: params.agentName,
				status: "running",
			})
			.returning({ id: schema.traces.id }),
	).pipe(
		Effect.map((rows) => {
			const row = rows[0]
			if (!row) throw new Error("Failed to create trace")
			return row.id
		}),
	)
}

export function completeTrace(
	query: QueryFn,
	traceId: string,
	status: "completed" | "failed",
	durationMs?: number,
): Effect.Effect<void, import("@amby/db").DbError> {
	return query((d) =>
		d
			.update(schema.traces)
			.set({
				status,
				completedAt: new Date(),
				durationMs: durationMs ?? null,
			})
			.where(eq(schema.traces.id, traceId)),
	).pipe(Effect.asVoid)
}

export function appendTraceEvent(
	query: QueryFn,
	traceId: string,
	kind: import("@amby/db").TraceEventKind,
	payload: Record<string, unknown>,
	seq: number,
): Effect.Effect<void, import("@amby/db").DbError> {
	return query((d) =>
		d.insert(schema.traceEvents).values({
			traceId,
			seq,
			kind,
			payload,
		}),
	).pipe(Effect.asVoid)
}

export function persistExecutionTrace(
	query: QueryFn,
	params: {
		conversationId: string
		threadId?: string
		messageId?: string
		agentName: string
		steps: ReadonlyArray<{
			toolCalls: ReadonlyArray<{
				toolCallId: string
				toolName: string
				input: unknown
			}>
			toolResults: ReadonlyArray<{
				toolCallId: string
				toolName: string
				output: unknown
			}>
		}>
		durationMs?: number
	},
): Effect.Effect<void, import("@amby/db").DbError> {
	return Effect.gen(function* () {
		// 1. Create root trace
		const rootTraceId = yield* createTrace(query, {
			conversationId: params.conversationId,
			threadId: params.threadId,
			messageId: params.messageId,
			agentName: params.agentName,
		})

		// 2. Batch insert trace events for all steps
		const rootEvents: Array<{
			traceId: string
			seq: number
			kind: import("@amby/db").TraceEventKind
			payload: Record<string, unknown>
		}> = []
		let seq = 0
		for (const step of params.steps) {
			for (const tc of step.toolCalls) {
				rootEvents.push({
					traceId: rootTraceId,
					seq: seq++,
					kind: "tool_call",
					payload: { toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input },
				})
			}
			for (const tr of step.toolResults) {
				rootEvents.push({
					traceId: rootTraceId,
					seq: seq++,
					kind: "tool_result",
					payload: { toolCallId: tr.toolCallId, toolName: tr.toolName, output: tr.output },
				})
			}
		}
		if (rootEvents.length > 0) {
			yield* query((d) => d.insert(schema.traceEvents).values(rootEvents))
		}

		// 3. Insert child traces for delegation results
		const orchResults = params.steps.flatMap((s) =>
			s.toolResults.map((tr) => ({
				toolCallId: tr.toolCallId,
				toolName: tr.toolName,
				output: tr.output,
			})),
		)

		for (const tr of orchResults) {
			if (
				!tr.toolName.startsWith("delegate_") ||
				typeof tr.output !== "object" ||
				tr.output === null ||
				!("_trace" in tr.output)
			) {
				continue
			}
			const subTrace = (
				tr.output as {
					_trace: {
						agentName: string
						steps: Array<{
							toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
							toolResults: Array<{
								toolCallId: string
								toolName: string
								output: unknown
							}>
						}>
						durationMs: number
					}
				}
			)._trace

			const childTraceId = yield* createTrace(query, {
				conversationId: params.conversationId,
				threadId: params.threadId,
				messageId: params.messageId,
				parentTraceId: rootTraceId,
				rootTraceId,
				agentName: subTrace.agentName,
			})

			const childEvents: Array<{
				traceId: string
				seq: number
				kind: import("@amby/db").TraceEventKind
				payload: Record<string, unknown>
			}> = []
			let childSeq = 0
			for (const childStep of subTrace.steps) {
				for (const tc of childStep.toolCalls) {
					childEvents.push({
						traceId: childTraceId,
						seq: childSeq++,
						kind: "tool_call",
						payload: { toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input },
					})
				}
				for (const tr of childStep.toolResults) {
					childEvents.push({
						traceId: childTraceId,
						seq: childSeq++,
						kind: "tool_result",
						payload: { toolCallId: tr.toolCallId, toolName: tr.toolName, output: tr.output },
					})
				}
			}
			if (childEvents.length > 0) {
				yield* query((d) => d.insert(schema.traceEvents).values(childEvents))
			}

			yield* completeTrace(query, childTraceId, "completed", subTrace.durationMs)
		}

		// 4. Complete root trace
		yield* completeTrace(query, rootTraceId, "completed", params.durationMs)
	}).pipe(
		Effect.catchAll((e) =>
			Effect.sync(() => {
				console.warn("[Traces] Persistence failed:", e)
			}),
		),
	)
}
