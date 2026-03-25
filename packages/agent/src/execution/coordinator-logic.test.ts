import { describe, expect, it } from "bun:test"
import type { ExecutionPlan } from "../types/execution"
import { materializePlan } from "./coordinator"

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

describe("materializePlan", () => {
	it("assigns UUIDs to all tasks", () => {
		const plan: ExecutionPlan = {
			strategy: "parallel",
			rationale: "",
			tasks: [stubTask, stubTask, stubTask],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		const ids = new Set(tasks.map((t) => t.id))
		expect(ids.size).toBe(3) // all unique
		for (const task of tasks) {
			expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
		}
	})

	it("single-task plan: rootTaskId equals task id", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [stubTask],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		expect(tasks[0]?.rootTaskId).toBe(tasks[0]?.id)
	})

	it("multi-task plan: all share rootTaskId === first task id", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [stubTask, stubTask, stubTask],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		const rootId = tasks[0]?.id ?? ""
		expect(rootId).not.toBe("")
		for (const task of tasks) {
			expect(task.rootTaskId).toBe(rootId)
		}
	})

	it("resolves task-N dependency refs to real UUIDs", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [
				stubTask,
				{ ...stubTask, dependencies: ["task-0"] },
				{ ...stubTask, dependencies: ["task-0", "task-1"] },
			],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		const first = tasks[0]
		const second = tasks[1]
		const third = tasks[2]
		expect(second?.dependencies).toContain(first?.id)
		expect(second?.dependencies).toHaveLength(1)
		expect(third?.dependencies).toContain(first?.id)
		expect(third?.dependencies).toContain(second?.id)
		expect(third?.dependencies).toHaveLength(2)
	})

	it("preserves non-task-N dependency refs as-is", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [{ ...stubTask, dependencies: ["external-dep-123"] }],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		expect(tasks[0]?.dependencies).toContain("external-dep-123")
		expect(tasks[0]?.dependencies).toHaveLength(1)
	})

	it("out-of-bounds task-N ref is preserved as-is", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [{ ...stubTask, dependencies: ["task-99"] }],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		// task-99 has no corresponding index, should be preserved
		expect(tasks[0]?.dependencies).toContain("task-99")
		expect(tasks[0]?.dependencies).toHaveLength(1)
	})

	it("sets depth=1 for all tasks", () => {
		const plan: ExecutionPlan = {
			strategy: "parallel",
			rationale: "",
			tasks: [stubTask, stubTask],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		for (const task of tasks) {
			expect(task.depth).toBe(1)
		}
	})

	it("preserves specialist and runnerKind from planned task", () => {
		const plan: ExecutionPlan = {
			strategy: "sequential",
			rationale: "",
			tasks: [
				{ ...stubTask, specialist: "builder" as const, runnerKind: "toolloop" as const },
				{
					...stubTask,
					specialist: "browser" as const,
					runnerKind: "browser_service" as const,
				},
			],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		expect(tasks[0]?.specialist).toBe("builder")
		expect(tasks[0]?.runnerKind).toBe("toolloop")
		expect(tasks[1]?.specialist).toBe("browser")
		expect(tasks[1]?.runnerKind).toBe("browser_service")
	})

	it("empty plan produces empty task list", () => {
		const plan: ExecutionPlan = {
			strategy: "direct",
			rationale: "",
			tasks: [],
			reducer: "conversation",
		}
		const tasks = materializePlan(plan)
		expect(tasks).toHaveLength(0)
	})
})
