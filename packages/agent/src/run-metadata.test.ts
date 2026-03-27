import { describe, expect, it } from "bun:test"
import {
	buildAgentRunMetadata,
	buildRootRunMetadata,
	buildTaskRunMetadata,
	normalizeRunEnvironment,
} from "./run-metadata"
import type { AgentRunConfig } from "./types/agent"

const request: AgentRunConfig["request"] = {
	requestId: "request-1",
	conversationId: "conversation-1",
	threadId: "thread-1",
	userId: "user-1",
	mode: "message",
	environment: "production",
	metadata: {
		telegram: {
			batched: true,
			messageCount: 3,
		},
	},
}

const config: AgentRunConfig = {
	request,
	modelPolicy: {
		defaultModelId: "model-1",
		lowLatencyModelId: "model-1",
		highReasoningModelId: "model-2",
		validatorModelId: "model-2",
	},
	runtime: {
		sandboxEnabled: true,
		cuaEnabled: false,
		integrationEnabled: false,
		streamingEnabled: false,
		browserEnabled: true,
	},
	policy: {
		allowDirectAnswer: true,
		allowBackgroundTasks: true,
		allowMemoryWrites: true,
		allowExternalWrites: true,
		requireWriteConfirmation: true,
		maxDepth: 1,
	},
	budgets: {
		maxConversationSteps: 8,
		maxSubagentStepsByKind: {},
		maxParallelAgents: 3,
		maxToolCallsPerRun: 32,
	},
	context: {
		sharedPromptContext: "",
		userTimezone: "UTC",
	},
	trace: {
		enabled: true,
		includeToolPayloads: true,
		includeContextEvents: true,
	},
}

describe("run metadata", () => {
	it("normalizes environments to the supported set", () => {
		expect(normalizeRunEnvironment("production")).toBe("production")
		expect(normalizeRunEnvironment("development")).toBe("development")
		expect(normalizeRunEnvironment("staging")).toBe("development")
		expect(normalizeRunEnvironment(undefined)).toBe("development")
		expect(normalizeRunEnvironment(null)).toBe("development")
	})

	it("builds agent metadata from request context", () => {
		expect(
			buildAgentRunMetadata({
				request,
				modelId: "gpt-5",
				agentRole: "specialist",
				specialistName: "builder",
				taskId: "task-1",
			}),
		).toEqual({
			request_id: "request-1",
			conversation_id: "conversation-1",
			request_mode: "message",
			environment: "production",
			source: "telegram",
			telegram_batched: true,
			telegram_message_count: 3,
			user_id: "user-1",
			model_id: "gpt-5",
			agent_role: "specialist",
			specialist_name: "builder",
			task_id: "task-1",
		})
	})

	it("builds persisted root run metadata from request context", () => {
		expect(buildRootRunMetadata(config)).toMatchObject({
			requestId: "request-1",
			conversationId: "conversation-1",
			environment: "production",
		})
	})

	it("builds persisted task run metadata from request context", () => {
		expect(
			buildTaskRunMetadata({
				request,
				executionRequest: {
					taskId: "task-1",
					rootTaskId: "task-1",
					depth: 1,
					specialist: "builder",
					runnerKind: "toolloop",
					dependencies: [],
					input: { kind: "specialist", goal: "Ship the patch." },
					resourceLocks: [],
					mutates: true,
					writesExternal: false,
					requiresConfirmation: false,
					requiresValidation: false,
				},
			}),
		).toMatchObject({
			environment: "production",
			request: expect.objectContaining({
				taskId: "task-1",
				rootTaskId: "task-1",
				specialist: "builder",
			}),
		})
	})
})
