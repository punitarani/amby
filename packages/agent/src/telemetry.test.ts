import type { LanguageModelV2, LanguageModelV2Content } from "@ai-sdk/provider"
import { trace } from "@opentelemetry/api"
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
	type ReadableSpan,
	type SpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { afterEach, describe, expect, test } from "bun:test"
import { stepCountIs, ToolLoopAgent } from "ai"
import { Effect } from "effect"
import { createSubagentTools } from "./subagents/spawner"
import {
	buildSharedTraceMetadata,
	createOrchestratorTraceMetadata,
	createSubagentTraceMetadata,
	createSubagentInvocationTracker,
	createTelemetrySettings,
	initializeTelemetry,
	resetTelemetryForTests,
	withTelemetryFlush,
} from "./telemetry"

;(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false

const USAGE = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
const SHARED = {
	requestId: "req_test",
	userId: "user_internal",
	conversationId: "conv_internal",
	messageCount: 1,
	historyLength: 0,
	toolCount: 4,
	modelId: "model_internal",
	replyToolEnabled: false,
	cuaEnabled: false,
} as const

const parentId = (span: ReadableSpan) =>
	"parentSpanContext" in span
		? span.parentSpanContext?.spanId
		: (span as ReadableSpan & { parentSpanId?: string }).parentSpanId

const span = (
	spans: ReadonlyArray<ReadableSpan>,
	name: string,
	attrs: Record<string, unknown> = {},
) =>
	spans.find(
		(item) =>
			item.name === name &&
			Object.entries(attrs).every(([key, value]) => item.attributes[key] === value),
	)

const model = (calls = 1): LanguageModelV2 => {
	const result = (content: LanguageModelV2Content[], finishReason: "stop" | "tool-calls") => ({
		content,
		finishReason,
		usage: USAGE,
		warnings: [],
	})
	const generate = async ({ prompt }: { prompt: Array<{ role: string; content: unknown }> }) => {
		const system = prompt.find((message) => message.role === "system")?.content
		if (typeof system === "string" && system.includes("planning specialist")) {
			return result([{ type: "text", text: "subagent summary" }], "stop")
		}

		if (!prompt.some((message) => message.role === "tool")) {
			return result(
				Array.from({ length: calls }, (_, i) => ({
					type: "tool-call",
					toolCallId: `planner-call-${i + 1}`,
					toolName: "delegate_planner",
					input: JSON.stringify({ task: `Plan step ${i + 1}` }),
				})),
				"tool-calls",
			)
		}

		return result([{ type: "text", text: "orchestrator final" }], "stop")
	}

	return {
		specificationVersion: "v2",
		provider: "test-provider",
		modelId: `test-model-${calls}`,
		supportedUrls: {},
		doGenerate: generate as LanguageModelV2["doGenerate"],
		doStream: (async ({ prompt }) => {
			const output = await generate({ prompt } as { prompt: Array<{ role: string; content: unknown }> })

			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "stream-start", warnings: [] })
						for (const part of output.content) {
							if (part.type === "text") {
								controller.enqueue({ type: "text-start", id: "text-1" })
								controller.enqueue({ type: "text-delta", id: "text-1", delta: part.text })
								controller.enqueue({ type: "text-end", id: "text-1" })
							}
							if (part.type === "tool-call") controller.enqueue(part)
						}
						controller.enqueue({ type: "finish", finishReason: output.finishReason, usage: output.usage })
						controller.close()
					},
				}),
			}
		}) as LanguageModelV2["doStream"],
	}
}

const setup = ({
	functionId,
	requestMode,
	calls = 1,
}: {
	functionId: "amby.orchestrator.generate" | "amby.orchestrator.stream"
	requestMode: "message" | "stream-message"
	calls?: number
}) => {
	const exporter = new InMemorySpanExporter()
	initializeTelemetry({ spanProcessors: [new SimpleSpanProcessor(exporter)] })

	const shared = buildSharedTraceMetadata({ ...SHARED, requestMode })
	const agentModel = model(calls)
	const orchestrator = new ToolLoopAgent({
		id: "orchestrator",
		model: agentModel,
		instructions: "You are the orchestrator.",
		tools: createSubagentTools(agentModel, {}, "", shared),
		stopWhen: stepCountIs(4),
		experimental_telemetry: createTelemetrySettings({
			functionId,
			metadata: createOrchestratorTraceMetadata(shared),
		}),
	})

	return { exporter, orchestrator }
}

const run = async (mode: "generate" | "stream", calls = 1) => {
	await resetTelemetryForTests()
	const functionId =
		mode === "generate" ? "amby.orchestrator.generate" : "amby.orchestrator.stream"
	const requestMode = mode === "generate" ? "message" : "stream-message"
	const { exporter, orchestrator } = setup({ functionId, requestMode, calls })

	if (mode === "generate") {
		expect((await orchestrator.generate({ prompt: "Plan this task." })).text).toBe("orchestrator final")
	} else {
		const streamResult = await orchestrator.stream({ prompt: "Stream this task." })
		for await (const _part of streamResult.fullStream) {
			// Fully consume the stream so root spans close before assertions.
		}
		expect(await streamResult.text).toBe("orchestrator final")
	}

	return exporter.getFinishedSpans()
}

afterEach(async () => {
	await resetTelemetryForTests()
})

describe("telemetry", () => {
	test("keeps metadata whitelisted and subagent invocations unique", () => {
		const shared = buildSharedTraceMetadata({
			...SHARED,
			requestId: "req_123",
			userId: "user_123",
			conversationId: "conv_123",
			requestMode: "batched-message",
			messageCount: 2,
			historyLength: 4,
			toolCount: 7,
			modelId: "model_123",
			replyToolEnabled: true,
			requestMetadata: {
				telegram: { batched: true, messageCount: 2, chatId: 999, username: "secret" },
				name: "Hidden Name",
				userTimezone: "America/Phoenix",
				extraField: "ignored",
			},
		})
		const next = createSubagentInvocationTracker()
		const firstInvocation = next()
		const secondInvocation = next()
		const first = createSubagentTraceMetadata(shared, {
			agentName: "planner",
			parentAgentName: "orchestrator",
			delegationTool: "delegate_planner",
			invocationId: firstInvocation.agent_invocation_id,
			invocationIndex: firstInvocation.agent_invocation_index,
		})
		const second = createSubagentTraceMetadata(shared, {
			agentName: "planner",
			parentAgentName: "orchestrator",
			delegationTool: "delegate_planner",
			invocationId: secondInvocation.agent_invocation_id,
			invocationIndex: secondInvocation.agent_invocation_index,
		})

		expect(shared).toEqual({
			request_id: "req_123",
			user_id: "user_123",
			conversation_id: "conv_123",
			request_mode: "batched-message",
			message_count: 2,
			history_length: 4,
			tool_count: 7,
			model_id: "model_123",
			reply_tool_enabled: true,
			cua_enabled: false,
			source: "telegram",
			telegram_batched: true,
			telegram_message_count: 2,
		})
		expect(first.agent_invocation_index).toBe(1)
		expect(second.agent_invocation_index).toBe(2)
		expect(first.agent_invocation_id).not.toBe(second.agent_invocation_id)
	})

	test("nests subagent traces correctly for generate and stream", async () => {
		for (const [mode, rootName, callName, functionId] of [
			["generate", "ai.generateText", "ai.generateText.doGenerate", "amby.orchestrator.generate"],
			["stream", "ai.streamText", "ai.streamText.doStream", "amby.orchestrator.stream"],
		] as const) {
			const spans = await run(mode)
			const root = span(spans, rootName, { "ai.telemetry.functionId": functionId })
			const call = span(spans, callName, { "ai.telemetry.functionId": functionId })
			const tool = span(spans, "ai.toolCall", { "ai.toolCall.name": "delegate_planner" })
			const subagent = span(spans, "ai.generateText", {
				"ai.telemetry.functionId": "amby.subagent.planner.generate",
			})
			const subagentCall = span(spans, "ai.generateText.doGenerate", {
				"ai.telemetry.functionId": "amby.subagent.planner.generate",
			})

			expect(root).toBeDefined()
			expect(call).toBeDefined()
			expect(tool).toBeDefined()
			expect(subagent).toBeDefined()
			expect(subagentCall).toBeDefined()
			expect(parentId(call!)).toBe(root!.spanContext().spanId)
			expect(parentId(tool!)).toBe(root!.spanContext().spanId)
			expect(parentId(subagent!)).toBe(tool!.spanContext().spanId)
			expect(parentId(subagentCall!)).toBe(subagent!.spanContext().spanId)
			expect(subagent!.attributes["ai.telemetry.metadata.agent_name"]).toBe("planner")
			expect(subagent!.attributes["ai.telemetry.metadata.parent_agent_name"]).toBe(
				"orchestrator",
			)
		}
	})

	test("tracks repeated subagent calls as separate invocations", async () => {
		const spans = await run("generate", 2)
		const roots = spans
			.filter(
				(item) =>
					item.name === "ai.generateText" &&
					item.attributes["ai.telemetry.functionId"] === "amby.subagent.planner.generate",
			)
			.sort(
				(a, b) =>
					Number(a.attributes["ai.telemetry.metadata.agent_invocation_index"]) -
					Number(b.attributes["ai.telemetry.metadata.agent_invocation_index"]),
			)

		expect(roots).toHaveLength(2)
		expect(roots[0]?.attributes["ai.telemetry.metadata.agent_invocation_index"]).toBe(1)
		expect(roots[1]?.attributes["ai.telemetry.metadata.agent_invocation_index"]).toBe(2)
		expect(roots[0]?.attributes["ai.telemetry.metadata.agent_invocation_id"]).not.toBe(
			roots[1]?.attributes["ai.telemetry.metadata.agent_invocation_id"],
		)
	})

	test("flushes telemetry when the wrapped effect finishes", async () => {
		let flushCalls = 0
		const exported: ReadableSpan[] = []
		const pending: ReadableSpan[] = []
		const processor: SpanProcessor = {
			onStart() {},
			onEnd(span) {
				pending.push(span)
			},
			async forceFlush() {
				flushCalls += 1
				exported.push(...pending.splice(0))
			},
			async shutdown() {
				await this.forceFlush()
			},
		}

		initializeTelemetry({ spanProcessors: [processor] })

		expect(
			await Effect.runPromise(
				withTelemetryFlush(
					Effect.tryPromise(() =>
						trace.getTracer("telemetry-test").startActiveSpan("manual-span", async (span) => {
							span.end()
							return "ok"
						}),
					),
				),
			),
		).toBe("ok")
		expect(flushCalls).toBe(1)
		expect(exported.map((item) => item.name)).toContain("manual-span")
	})
})
