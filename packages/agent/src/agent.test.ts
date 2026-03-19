import { beforeEach, describe, expect, mock, test } from "bun:test"
import { SandboxService, TaskSupervisor } from "@amby/computer"
import { DbService, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { MemoryService } from "@amby/memory"
import { ModelService } from "@amby/models"
import { type Context, Effect, Layer } from "effect"

type FakeAgentCall = {
	config: Record<string, unknown>
	options: Record<string, unknown> & {
		prompt?: string
		abortSignal?: AbortSignal
		onStepFinish?: (event: {
			stepNumber: number
			finishReason: string
			usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
			toolCalls?: Array<{ toolName: string }>
		}) => Promise<void> | void
		onFinish?: (event: {
			totalUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
			steps: unknown[]
		}) => Promise<void> | void
	}
}
type FakeGenerateResult = {
	text: string
	toolResults: Array<{ output?: unknown }>
}
type FakeStreamResult = {
	fullStream: AsyncIterable<Record<string, unknown>>
	text: Promise<string>
}

const braintrustState = {
	agentConfigs: [] as Array<Record<string, unknown>>,
	generateCalls: [] as Array<Record<string, unknown>>,
	streamCalls: [] as Array<Record<string, unknown>>,
	traceCalls: [] as Array<Record<string, unknown>>,
	initializeCalls: [] as Array<unknown[]>,
	flushCalls: 0,
	generateHandler: async (_call: FakeAgentCall): Promise<FakeGenerateResult> => ({
		text: "ok",
		toolResults: [] as Array<{ output?: unknown }>,
	}),
	streamHandler: async (_call: FakeAgentCall): Promise<FakeStreamResult> => ({
		fullStream: (async function* () {})(),
		text: Promise.resolve(""),
	}),
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

class FakeToolLoopAgent {
	config: Record<string, unknown>

	constructor(config: Record<string, unknown>) {
		this.config = config
		braintrustState.agentConfigs.push(config)
	}

	async generate(options: Record<string, unknown>) {
		braintrustState.generateCalls.push({ config: this.config, options })
		return await braintrustState.generateHandler({ config: this.config, options })
	}

	async stream(options: Record<string, unknown>) {
		braintrustState.streamCalls.push({ config: this.config, options })
		return await braintrustState.streamHandler({ config: this.config, options })
	}
}

mock.module(new URL("./braintrust.ts", import.meta.url).pathname, () => ({
	ToolLoopAgent: FakeToolLoopAgent,
	stepCountIs: (count: number) => ({ type: "step-count", count }),
	initializeBraintrust: (...args: unknown[]) => {
		braintrustState.initializeCalls.push(args)
	},
	traceBraintrustOperation: async (
		name: string,
		input: unknown,
		metadata: Record<string, unknown>,
		operation: () => Promise<unknown>,
		extractOutput: (result: unknown) => unknown = (result) => result,
	) => {
		try {
			const result = await operation()
			braintrustState.traceCalls.push({
				name,
				input,
				metadata: clone(metadata),
				output: clone(extractOutput(result)),
			})
			return result
		} catch (error) {
			braintrustState.traceCalls.push({
				name,
				input,
				metadata: clone(metadata),
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	},
	flushBraintrust: () => {
		braintrustState.flushCalls += 1
	},
	tool: <T extends Record<string, unknown>>(definition: T) => definition,
}))

const { AgentService, makeAgentServiceLive } = await import("./agent")
const { createSubagentTools } = await import("./subagents/spawner")

type SavedMessage = {
	conversationId: string
	role: "user" | "assistant" | "system" | "tool"
	content: string
	metadata?: Record<string, unknown>
	createdAt: Date
}
type FakeDb = {
	select: () => {
		from: (table: unknown) => {
			where: () => {
				limit: (count: number) => Promise<unknown[]>
				orderBy: () => { limit: (count: number) => Promise<unknown[]> }
			}
		}
	}
	insert: (table: unknown) => {
		values: (
			values: Record<string, unknown>,
		) => Promise<unknown[]> | { returning: () => Promise<Array<{ id: string }>> }
	}
	update: () => {
		set: (values: Record<string, unknown>) => { where: () => Promise<void> }
	}
	transaction: <T>(fn: (tx: FakeDb) => Promise<T>) => Promise<T>
}
type DelegatePlannerTool = {
	execute: (
		input: { task: string; context?: string },
		options: { abortSignal?: AbortSignal; toolCallId: string; messages: unknown[] },
	) => Promise<unknown>
}

const createDbState = () => ({
	userTimezone: "America/Los_Angeles",
	messages: [] as SavedMessage[],
	conversations: [] as Array<{ id: string; updatedAt: Date }>,
})

const createDbService = (state: ReturnType<typeof createDbState>) => {
	const buildLimit = (table: unknown) => async (count: number) => {
		if (table === schema.messages) {
			return state.messages
				.slice()
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
				.slice(0, count)
				.map(({ role, content }) => ({ role, content }))
		}

		if (table === schema.users) {
			return [{ timezone: state.userTimezone }]
		}

		if (table === schema.conversations) {
			return state.conversations
				.slice()
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
				.slice(0, count)
				.map(({ id }) => ({ id }))
		}

		return []
	}

	const db = {} as FakeDb

	db.select = () => ({
		from: (table: unknown) => ({
			where: () => {
				const limit = buildLimit(table)
				return {
					limit,
					orderBy: () => ({ limit }),
				}
			},
		}),
	})
	db.insert = (table: unknown) => ({
		values: (values: Record<string, unknown>) => {
			if (table === schema.messages) {
				const row: SavedMessage = {
					conversationId: values.conversationId as string,
					role: values.role as SavedMessage["role"],
					content: values.content as string,
					metadata: values.metadata as Record<string, unknown> | undefined,
					createdAt: new Date(),
				}
				state.messages.push(row)
				return Promise.resolve([row])
			}

			if (table === schema.conversations) {
				return {
					returning: async () => {
						const row = { id: `conv-${state.conversations.length + 1}`, updatedAt: new Date() }
						state.conversations.push(row)
						return [{ id: row.id }]
					},
				}
			}

			if (table === schema.jobs) {
				return {
					returning: async () => [{ id: "job-1" }],
				}
			}

			return Promise.resolve([])
		},
	})
	db.update = () => ({
		set: (values: Record<string, unknown>) => ({
			where: async () => {
				if (typeof values.timezone === "string") {
					state.userTimezone = values.timezone
				}
			},
		}),
	})
	db.transaction = async <T>(fn: (tx: FakeDb) => Promise<T>) => fn(db)

	return {
		db: db as never,
		query: <T>(fn: (client: FakeDb) => Promise<T>) =>
			Effect.tryPromise(() => Promise.resolve(fn(db))),
	}
}

const createEnvService = () => ({
	NODE_ENV: "test",
	OPENROUTER_API_KEY: "openrouter",
	OPENAI_API_KEY: "openai",
	CARTESIA_API_KEY: "",
	DAYTONA_API_KEY: "",
	DAYTONA_API_URL: "",
	DAYTONA_TARGET: "",
	TELEGRAM_BOT_TOKEN: "",
	TELEGRAM_WEBHOOK_SECRET: "",
	DATABASE_URL: "postgres://localhost/test",
	BETTER_AUTH_SECRET: "",
	BETTER_AUTH_URL: "",
	ENABLE_CUA: false,
	BRAINTRUST_API_KEY: "braintrust",
	BRAINTRUST_PROJECT_NAME: "Amby Agent",
	POSTHOG_KEY: "",
	POSTHOG_HOST: "",
})

const createMemoryService = () => ({
	add: () => Effect.succeed("memory-1"),
	getProfile: () => Effect.succeed({ static: [], dynamic: [] }),
	deactivate: () => Effect.void,
})

const createModelService = () => ({
	getModel: () => ({ modelId: "fake-model" }) as never,
	defaultModelId: "fake-model",
})

const createSandboxService = () => ({
	enabled: false,
	ensure: () => Effect.fail(new Error("sandbox disabled")),
	exec: () => Effect.fail(new Error("sandbox disabled")),
	readFile: () => Effect.fail(new Error("sandbox disabled")),
	writeFile: () => Effect.fail(new Error("sandbox disabled")),
	stop: () => Effect.void,
})

const createTaskSupervisor = () => ({
	getCodexAuthStatus: () => Effect.fail(new Error("unused")),
	setCodexApiKey: () => Effect.fail(new Error("unused")),
	startCodexChatgptAuth: () => Effect.fail(new Error("unused")),
	importCodexChatgptAuth: () => Effect.fail(new Error("unused")),
	clearCodexAuth: () => Effect.fail(new Error("unused")),
	startTask: () => Effect.fail(new Error("unused")),
	getTask: () => Effect.succeed(null),
	shutdown: () => Effect.void,
})

const withAgent = async <T>(
	state: ReturnType<typeof createDbState>,
	run: (agent: Context.Tag.Service<typeof AgentService>) => Effect.Effect<T, unknown>,
) => {
	const appLayer = makeAgentServiceLive("user-1").pipe(
		Layer.provideMerge(Layer.succeed(MemoryService, createMemoryService() as never)),
		Layer.provideMerge(Layer.succeed(TaskSupervisor, createTaskSupervisor() as never)),
		Layer.provideMerge(Layer.succeed(ModelService, createModelService() as never)),
		Layer.provideMerge(Layer.succeed(SandboxService, createSandboxService() as never)),
		Layer.provideMerge(Layer.succeed(DbService, createDbService(state) as never)),
		Layer.provideMerge(Layer.succeed(EnvService, createEnvService() as never)),
	)

	return await Effect.runPromise(
		Effect.gen(function* () {
			const agent = yield* AgentService
			return yield* run(agent)
		}).pipe(Effect.provide(appLayer)),
	)
}

beforeEach(() => {
	braintrustState.agentConfigs.length = 0
	braintrustState.generateCalls.length = 0
	braintrustState.streamCalls.length = 0
	braintrustState.traceCalls.length = 0
	braintrustState.initializeCalls.length = 0
	braintrustState.flushCalls = 0
	braintrustState.generateHandler = async (_call: FakeAgentCall): Promise<FakeGenerateResult> => ({
		text: "ok",
		toolResults: [],
	})
	braintrustState.streamHandler = async (_call: FakeAgentCall): Promise<FakeStreamResult> => ({
		fullStream: (async function* () {})(),
		text: Promise.resolve(""),
	})
})

describe("AgentService", () => {
	test("handleMessage uses ToolLoopAgent, persists messages, and records lifecycle metadata", async () => {
		const state = createDbState()
		braintrustState.generateHandler = async ({ options }: FakeAgentCall) => {
			await options.onStepFinish?.({
				stepNumber: 1,
				finishReason: "tool-calls",
				usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
				toolCalls: [{ toolName: "search_memories" }],
			})
			await options.onFinish?.({
				totalUsage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
				steps: [{}, {}],
			})
			return { text: "final answer", toolResults: [] }
		}

		const result = await withAgent(state, (agent) =>
			agent.handleMessage("conv-1", "hello", { telegram: { batched: false, messageCount: 1 } }),
		)

		expect(result).toBe("final answer")
		expect(state.messages.map(({ role, content }) => ({ role, content }))).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "final answer" },
		])
		expect(braintrustState.traceCalls[0]).toMatchObject({
			name: "agent.handle-message",
			output: { text: "final answer" },
		})
		expect(braintrustState.traceCalls[0]?.metadata).toMatchObject({
			mode: "message",
			messageCount: 1,
			historyLength: 0,
			toolCount: expect.any(Number),
			userTimezone: "America/Los_Angeles",
			modelId: "fake-model",
			stepCount: 2,
			stepFinishReasons: ["tool-calls"],
			toolNames: ["search_memories"],
			totalUsage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
			requestMetadata: {
				keys: ["telegram"],
				source: "telegram",
				telegramBatched: false,
				telegramMessageCount: 1,
			},
		})
		expect(braintrustState.agentConfigs[0]?.instructions).toContain("Current Date/Time")
	})

	test("handleBatchedMessages persists each user turn and one assistant response", async () => {
		const state = createDbState()
		braintrustState.generateHandler = async () => ({ text: "batched answer", toolResults: [] })

		const result = await withAgent(state, (agent) =>
			agent.handleBatchedMessages("conv-1", ["first", "second"]),
		)

		expect(result).toBe("batched answer")
		expect(state.messages.map(({ role, content }) => ({ role, content }))).toEqual([
			{ role: "user", content: "first" },
			{ role: "user", content: "second" },
			{ role: "assistant", content: "batched answer" },
		])
	})

	test("streamMessage forwards stream parts in order and persists the final text", async () => {
		const state = createDbState()
		const parts: Array<Record<string, unknown>> = []
		braintrustState.streamHandler = async ({ options }: FakeAgentCall) => {
			await options.onStepFinish?.({
				stepNumber: 1,
				finishReason: "stop",
				usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
				toolCalls: [{ toolName: "delegate_planner" }],
			})
			await options.onFinish?.({
				totalUsage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
				steps: [{}],
			})

			return {
				fullStream: (async function* () {
					yield { type: "text-delta", text: "hello " }
					yield { type: "tool-call", toolName: "delegate_planner", input: { task: "plan" } }
					yield { type: "tool-result", toolName: "delegate_planner", output: { summary: "done" } }
				})(),
				text: Promise.resolve("hello world"),
			}
		}

		const result = await withAgent(state, (agent) =>
			agent.streamMessage("conv-1", "stream this", (part: Record<string, unknown>) =>
				parts.push(part),
			),
		)

		expect(result).toBe("hello world")
		expect(parts).toEqual([
			{ type: "text-delta", text: "hello " },
			{ type: "tool-call", toolName: "delegate_planner", args: { task: "plan" } },
			{ type: "tool-result", toolName: "delegate_planner", result: { summary: "done" } },
		])
		expect(state.messages.map(({ role, content }) => ({ role, content }))).toEqual([
			{ role: "user", content: "stream this" },
			{ role: "assistant", content: "hello world" },
		])
	})

	test("tool results with userMessages call onReply and suppress the final assistant text", async () => {
		const state = createDbState()
		const replies: string[] = []
		braintrustState.generateHandler = async (_call: FakeAgentCall) => ({
			text: "ignore me",
			toolResults: [{ output: { userMessages: ["one", "two"] } }],
		})

		const result = await withAgent(state, (agent) =>
			agent.handleMessage("conv-1", "setup auth", undefined, async (text: string) => {
				replies.push(text)
			}),
		)

		expect(result).toBe("")
		expect(replies).toEqual(["one", "two"])
		expect(state.messages.map(({ role, content }) => ({ role, content }))).toEqual([
			{ role: "user", content: "setup auth" },
		])
	})
})

describe("createSubagentTools", () => {
	test("delegation tools use ToolLoopAgent.generate and forward abortSignal", async () => {
		braintrustState.generateHandler = async ({ options }: FakeAgentCall) => ({
			text: `summary:${options.prompt}`,
			toolResults: [],
		})
		const abortController = new AbortController()
		const tools = createSubagentTools(
			{ modelId: "fake-subagent-model" } as never,
			{},
			"shared context",
		)
		const delegatePlanner = tools.delegate_planner as unknown as DelegatePlannerTool

		const result = await delegatePlanner.execute(
			{ task: "plan task", context: "extra context" },
			{ abortSignal: abortController.signal, toolCallId: "tool-1", messages: [] },
		)

		expect(result).toEqual({
			summary: "summary:plan task\n\nAdditional context: extra context",
		})
		expect(braintrustState.generateCalls.at(-1)?.options).toMatchObject({
			prompt: "plan task\n\nAdditional context: extra context",
			abortSignal: abortController.signal,
		})
		expect(braintrustState.agentConfigs.at(-1)).toMatchObject({
			instructions: expect.stringContaining("# Context\nshared context"),
			stopWhen: { type: "step-count", count: 5 },
		})
	})

	test("delegation tools return a normal error payload when the subagent fails", async () => {
		braintrustState.generateHandler = async (_call: FakeAgentCall) => {
			throw new Error("boom")
		}
		const tools = createSubagentTools({ modelId: "fake-subagent-model" } as never, {}, "")
		const delegatePlanner = tools.delegate_planner as unknown as DelegatePlannerTool

		const result = await delegatePlanner.execute(
			{ task: "plan task" },
			{ abortSignal: undefined, toolCallId: "tool-2", messages: [] },
		)

		expect(result).toEqual({
			error: true,
			summary: "Failed to complete task: boom",
		})
	})
})
