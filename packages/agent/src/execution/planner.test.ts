import { describe, expect, it } from "bun:test"
import type { AgentRunConfig } from "../types/agent"
import type { ExecutionPlan } from "../types/execution"
import { materializePlan } from "./coordinator"
import { buildHeuristicPlan, shouldUseModelPlanner } from "./planner"

const stubConfig: AgentRunConfig = {
	request: {
		requestId: "test",
		conversationId: "test",
		userId: "test",
		mode: "message",
		environment: "development",
	},
	modelPolicy: {
		defaultModelId: "test-model",
		lowLatencyModelId: "test-model",
		highReasoningModelId: "test-model",
		validatorModelId: "test-model",
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
		enabled: false,
		includeToolPayloads: false,
		includeContextEvents: false,
	},
}

describe("buildHeuristicPlan", () => {
	it("returns direct for simple greetings", () => {
		const plan = buildHeuristicPlan({ request: "Hello, how are you?", config: stubConfig })
		expect(plan.strategy).toBe("direct")
		expect(plan.tasks).toHaveLength(0)
	})

	it("routes memory save requests to the memory specialist", () => {
		const plan = buildHeuristicPlan({
			request: "Remember this: my favorite color is blue",
			config: stubConfig,
		})
		expect(plan.strategy).toBe("sequential")
		expect(plan.tasks).toHaveLength(1)
		expect(plan.tasks[0]?.specialist).toBe("memory")
	})

	it("routes browser URLs to browser specialist", () => {
		const plan = buildHeuristicPlan({
			request: "Open https://example.com and summarize it",
			config: stubConfig,
		})
		expect(plan.tasks.length).toBeGreaterThanOrEqual(1)
		expect(plan.tasks.some((t) => t.specialist === "browser")).toBe(true)
	})

	it("routes multiple URLs to parallel browser plan", () => {
		const plan = buildHeuristicPlan({
			request: "Compare https://example.com and https://example.org and summarize the differences",
			config: stubConfig,
		})
		expect(plan.strategy).toBe("parallel")
		expect(plan.tasks).toHaveLength(2)
		expect(plan.tasks.every((t) => t.specialist === "browser")).toBe(true)
	})

	it("sanitizes quoted browser URLs before building the task", () => {
		const plan = buildHeuristicPlan({
			request: 'Open "https://www.nytimes.com" and summarize the homepage',
			config: stubConfig,
		})
		const task = plan.tasks.find((candidate) => candidate.specialist === "browser")
		expect(task).toBeDefined()
		expect(task?.input.kind).toBe("browser")
		if (task?.input.kind === "browser") {
			expect(task.input.task.startUrl).toBe("https://www.nytimes.com/")
		}
	})

	it("routes code changes to builder specialist", () => {
		const plan = buildHeuristicPlan({
			request: "Implement a new login form component",
			config: stubConfig,
		})
		expect(plan.strategy).toBe("sequential")
		expect(plan.tasks[0]?.specialist).toBe("builder")
		expect(plan.tasks[0]?.mutates).toBe(true)
		expect(plan.reducer).toBe("validator")
	})

	it("routes research + builder to sequential with dependency", () => {
		const plan = buildHeuristicPlan({
			request: "Research the codebase patterns and then implement a new API endpoint",
			config: stubConfig,
		})
		expect(plan.strategy).toBe("sequential")
		expect(plan.tasks).toHaveLength(2)
		expect(plan.tasks[0]?.specialist).toBe("research")
		expect(plan.tasks[1]?.specialist).toBe("builder")
		expect(plan.tasks[1]?.dependencies).toContain("task-0")
	})

	it("routes background requests to background_handoff runner", () => {
		const plan = buildHeuristicPlan({
			request: "Work on this in the background: set up the project",
			config: stubConfig,
		})
		expect(plan.strategy).toBe("background")
		expect(plan.tasks).toHaveLength(1)
		expect(plan.tasks[0]?.runnerKind).toBe("background_handoff")
	})

	it("routes integration requests to the integration specialist", () => {
		const plan = buildHeuristicPlan({
			request: "Check my Gmail for new messages",
			config: stubConfig,
		})
		expect(plan.strategy).toBe("sequential")
		expect(plan.tasks[0]?.specialist).toBe("integration")
	})

	it("routes settings/timezone requests to settings specialist", () => {
		const plan = buildHeuristicPlan({
			request: "Set my timezone to America/New_York",
			config: stubConfig,
		})
		expect(plan.strategy).toBe("sequential")
		expect(plan.tasks[0]?.specialist).toBe("settings")
	})

	it("extracts timezone from 'Set my timezone to America/New_York'", () => {
		const plan = buildHeuristicPlan({
			request: "Set my timezone to America/New_York",
			config: stubConfig,
		})
		const task = plan.tasks[0]
		expect(task?.input.kind).toBe("settings")
		if (task?.input.kind === "settings") {
			expect(task.input.task).toEqual({
				kind: "timezone",
				timezone: "America/New_York",
			})
		}
	})

	it("extracts 3-part IANA timezone America/Indiana/Knox", () => {
		const plan = buildHeuristicPlan({
			request: "Set my timezone to America/Indiana/Knox",
			config: stubConfig,
		})
		const task = plan.tasks[0]
		if (task?.input.kind === "settings") {
			expect(task.input.task).toEqual({
				kind: "timezone",
				timezone: "America/Indiana/Knox",
			})
		}
	})

	it("extracts UTC as timezone", () => {
		const plan = buildHeuristicPlan({
			request: "Set my timezone to UTC",
			config: stubConfig,
		})
		const task = plan.tasks[0]
		if (task?.input.kind === "settings") {
			expect(task.input.task).toEqual({
				kind: "timezone",
				timezone: "UTC",
			})
		}
	})

	it("routes desktop requests to computer specialist", () => {
		const plan = buildHeuristicPlan({
			request: "Take a screenshot of the desktop",
			config: stubConfig,
		})
		expect(plan.strategy).toBe("sequential")
		expect(plan.tasks[0]?.specialist).toBe("computer")
	})

	it("falls back to research for read-oriented requests", () => {
		const plan = buildHeuristicPlan({
			request: "Investigate the authentication middleware",
			config: stubConfig,
		})
		expect(plan.strategy).toBe("sequential")
		expect(plan.tasks[0]?.specialist).toBe("research")
	})
})

describe("shouldUseModelPlanner", () => {
	it("returns false for direct plans", () => {
		const plan: ExecutionPlan = {
			strategy: "direct",
			rationale: "",
			tasks: [],
			reducer: "conversation",
		}
		expect(shouldUseModelPlanner("hello", plan)).toBe(false)
	})

	it("returns true when heuristic produces 3+ tasks", () => {
		const plan: ExecutionPlan = {
			strategy: "parallel",
			rationale: "",
			tasks: [{} as never, {} as never, {} as never],
			reducer: "conversation",
		}
		expect(shouldUseModelPlanner("do something", plan)).toBe(true)
	})

	it("returns true for step-by-step language", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [{} as never],
			reducer: "conversation",
		}
		expect(shouldUseModelPlanner("plan this carefully step by step", plan)).toBe(true)
	})
})

describe("materializePlan", () => {
	const stubTask = {
		specialist: "research" as const,
		runnerKind: "toolloop" as const,
		mode: "sequential" as const,
		input: { kind: "specialist" as const, goal: "test", payload: {} },
		dependencies: [],
		inputBindings: {},
		resourceLocks: [],
		mutates: false,
		writesExternal: false,
		requiresConfirmation: false,
		requiresValidation: false,
	}

	it("single-task plan: rootTaskId equals task id", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [stubTask],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		expect(tasks).toHaveLength(1)
		const first = tasks[0]
		expect(first?.rootTaskId).toBe(first?.id)
	})

	it("multi-task plan: all tasks share rootTaskId === ids[0]", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [stubTask, { ...stubTask, dependencies: ["task-0"] }],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		expect(tasks).toHaveLength(2)
		const first = tasks[0]
		const second = tasks[1]
		expect(first?.rootTaskId).toBe(first?.id)
		expect(second?.rootTaskId).toBe(first?.id)
	})

	it("resolves task-N dependency references to UUIDs", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [stubTask, { ...stubTask, dependencies: ["task-0"] }],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		const first = tasks[0]
		const second = tasks[1]
		expect(second?.dependencies).toContain(first?.id)
		expect(second?.dependencies).not.toContain("task-0")
	})
})
