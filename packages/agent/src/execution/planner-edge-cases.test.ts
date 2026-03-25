import { describe, expect, it } from "bun:test"
import { makeAgentRunConfig } from "../test-helpers/factories"
import { buildHeuristicPlan, shouldUseModelPlanner } from "./planner"

const config = makeAgentRunConfig()

describe("buildHeuristicPlan — precedence ordering", () => {
	it("background wins over all other signals", () => {
		const plan = buildHeuristicPlan({
			request: "Work on this in the background: implement the browser feature and remember this",
			config,
		})
		expect(plan.strategy).toBe("background")
		expect(plan.tasks).toHaveLength(1)
		expect(plan.tasks[0]?.runnerKind).toBe("background_handoff")
	})

	it("settings wins over memory, integration, computer, browser, builder", () => {
		const plan = buildHeuristicPlan({
			request: "Set my timezone and remember this for the browser",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("settings")
	})

	it("memory wins over integration, computer, browser, builder", () => {
		const plan = buildHeuristicPlan({
			request:
				"Remember this: the gmail integration uses a browser extension to implement features",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("memory")
	})

	it("integration wins over computer, browser, builder", () => {
		const plan = buildHeuristicPlan({
			request: "Check my Gmail and take a screenshot of the desktop to implement it",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("integration")
	})

	it("computer wins over browser and builder", () => {
		const plan = buildHeuristicPlan({
			request: "Take a screenshot of the desktop and open the browser to implement it",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("computer")
	})

	it("browser+research produces parallel plan", () => {
		const plan = buildHeuristicPlan({
			request: "Open the browser and research the website https://example.com",
			config,
		})
		expect(plan.strategy).toBe("parallel")
		expect(plan.tasks).toHaveLength(2)
		const specialists = plan.tasks.map((t) => t.specialist)
		expect(specialists).toContain("browser")
		expect(specialists).toContain("research")
	})

	it("builder+research produces sequential with dependency", () => {
		const plan = buildHeuristicPlan({
			request: "Research the database layer then implement the migration",
			config,
		})
		expect(plan.strategy).toBe("sequential")
		expect(plan.tasks).toHaveLength(2)
		expect(plan.tasks[0]?.specialist).toBe("research")
		expect(plan.tasks[1]?.specialist).toBe("builder")
		expect(plan.tasks[1]?.dependencies).toContain("task-0")
	})

	it("builder alone routes to builder with validator reducer", () => {
		const plan = buildHeuristicPlan({
			request: "Implement a new login form",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("builder")
		expect(plan.reducer).toBe("validator")
	})

	it("browser alone routes to browser", () => {
		const plan = buildHeuristicPlan({
			request: "Open the website at https://example.com",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("browser")
	})

	it("pure research falls through to research fallback", () => {
		const plan = buildHeuristicPlan({
			request: "Investigate the performance issue in the database layer",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("research")
		expect(plan.reducer).toBe("conversation")
	})
})

describe("buildHeuristicPlan — multi-URL parallel triggering", () => {
	it("multiple URLs produce parallel browser tasks", () => {
		const plan = buildHeuristicPlan({
			request: "Compare https://a.com and https://b.com and https://c.com",
			config,
		})
		expect(plan.strategy).toBe("parallel")
		expect(plan.tasks).toHaveLength(3)
		expect(plan.tasks.every((t) => t.specialist === "browser")).toBe(true)
	})

	it("single URL does not trigger multi-URL parallel", () => {
		const plan = buildHeuristicPlan({
			request: "Open https://example.com and check it out",
			config,
		})
		// Single URL should go to browser, not parallel multi-URL plan
		expect(plan.tasks).toHaveLength(1)
		expect(plan.tasks[0]?.specialist).toBe("browser")
	})
})

describe("buildHeuristicPlan — hard-write detection suppresses parallel", () => {
	it("multi-URL with hard-write keyword does not go parallel", () => {
		const plan = buildHeuristicPlan({
			request: "Submit a form on https://a.com and then post to https://b.com",
			config,
		})
		// Hard-write detected → not parallel browser
		expect(plan.strategy).not.toBe("parallel")
	})

	it("integration with hard-write triggers validation", () => {
		const plan = buildHeuristicPlan({
			request: "Send an email via Gmail to the team",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("integration")
		expect(plan.tasks[0]?.writesExternal).toBe(true)
		expect(plan.tasks[0]?.requiresConfirmation).toBe(true)
		expect(plan.reducer).toBe("validator")
	})
})

describe("buildHeuristicPlan — empty/no-signal input", () => {
	it("empty string returns direct strategy", () => {
		const plan = buildHeuristicPlan({ request: "", config })
		expect(plan.strategy).toBe("direct")
		expect(plan.tasks).toHaveLength(0)
	})

	it("simple greeting returns direct strategy", () => {
		const plan = buildHeuristicPlan({ request: "hi there", config })
		expect(plan.strategy).toBe("direct")
	})

	it("whitespace-only returns direct strategy", () => {
		const plan = buildHeuristicPlan({ request: "   \n\t  ", config })
		expect(plan.strategy).toBe("direct")
	})
})

describe("buildHeuristicPlan — path hints", () => {
	it("builder task includes path hints as resource locks", () => {
		const plan = buildHeuristicPlan({
			request: "Fix the bug in /src/billing/totals.ts and /src/billing/invoice.ts",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("builder")
		expect(plan.tasks[0]?.resourceLocks).toContain("fs-write:/src/billing/totals.ts")
		expect(plan.tasks[0]?.resourceLocks).toContain("fs-write:/src/billing/invoice.ts")
	})

	it("builder task without path hints uses generic sandbox lock", () => {
		const plan = buildHeuristicPlan({
			request: "Implement a new utility function",
			config,
		})
		expect(plan.tasks[0]?.specialist).toBe("builder")
		expect(plan.tasks[0]?.resourceLocks).toContain("sandbox-workdir:/")
	})
})

describe("buildHeuristicPlan — settings sub-routing", () => {
	it("reminder request routes to schedule kind", () => {
		const plan = buildHeuristicPlan({
			request: "Remind me to check the deploy every day at 9am",
			config,
		})
		const task = plan.tasks[0]
		expect(task?.specialist).toBe("settings")
		if (task?.input.kind === "settings") {
			expect(task.input.task.kind).toBe("schedule")
		}
	})

	it("codex auth request routes to codex_auth kind", () => {
		const plan = buildHeuristicPlan({
			request: "Set up my codex auth",
			config,
		})
		const task = plan.tasks[0]
		expect(task?.specialist).toBe("settings")
		if (task?.input.kind === "settings") {
			expect(task.input.task.kind).toBe("codex_auth")
		}
	})
})

describe("shouldUseModelPlanner — additional edge cases", () => {
	it("returns false for direct strategy regardless of language", () => {
		expect(
			shouldUseModelPlanner("plan this carefully step by step", {
				strategy: "direct",
				rationale: "",
				tasks: [],
				reducer: "conversation",
			}),
		).toBe(false)
	})

	it("returns true when 'after that' appears in request", () => {
		expect(
			shouldUseModelPlanner("do X, after that do Y", {
				strategy: "sequential",
				rationale: "",
				tasks: [{} as never],
				reducer: "conversation",
			}),
		).toBe(true)
	})

	it("returns false for simple request with 1 task and no planning language", () => {
		expect(
			shouldUseModelPlanner("open the website", {
				strategy: "sequential",
				rationale: "",
				tasks: [{} as never],
				reducer: "conversation",
			}),
		).toBe(false)
	})
})
