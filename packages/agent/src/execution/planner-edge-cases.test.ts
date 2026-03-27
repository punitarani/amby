import { describe, expect, it } from "bun:test"
import { materializeRouterOutput, type RouterOutput } from "./planner"

// ---------------------------------------------------------------------------
// Edge cases for materializeRouterOutput — ensures mechanical defaults are
// correct for various specialist configurations and boundary conditions.
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — mixed specialist plans", () => {
	it("research → builder sequential plan materializes correctly", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Research first, then implement",
			tasks: [
				{
					specialist: "research",
					goal: "Investigate the database layer",
					dependencies: [],
				},
				{
					specialist: "builder",
					goal: "Implement the migration",
					dependencies: ["task-0"],
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.strategy).toBe("sequential")
		expect(plan.tasks).toHaveLength(2)
		expect(plan.tasks[0]?.specialist).toBe("research")
		expect(plan.tasks[0]?.mutates).toBe(false)
		expect(plan.tasks[1]?.specialist).toBe("builder")
		expect(plan.tasks[1]?.mutates).toBe(true)
		expect(plan.tasks[1]?.dependencies).toContain("task-0")
		expect(plan.reducer).toBe("validator")
	})
})

describe("materializeRouterOutput — browser task defaults", () => {
	it("browser task without startUrl uses undefined (no fallback to extracted URLs)", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Browse",
			tasks: [
				{
					specialist: "browser",
					goal: "Find something on the web",
					dependencies: [],
					browserMode: "agent",
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.input.kind).toBe("browser")
		if (plan.tasks[0]?.input.kind === "browser") {
			// startUrl comes from the router task, not from extracted URLs
			expect(plan.tasks[0].input.task.startUrl).toBeUndefined()
		}
	})
})

describe("materializeRouterOutput — background strategy", () => {
	it("sets needsBrowser=true when specialist is browser", () => {
		const output: RouterOutput = {
			strategy: "background",
			rationale: "Long-running browser work",
			tasks: [
				{
					specialist: "browser",
					goal: "Monitor the site continuously",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.input.kind).toBe("background")
		if (plan.tasks[0]?.input.kind === "background") {
			expect(plan.tasks[0].input.needsBrowser).toBe(true)
		}
	})

	it("sets needsBrowser=false when specialist is not browser", () => {
		const output: RouterOutput = {
			strategy: "background",
			rationale: "Long-running code work",
			tasks: [
				{
					specialist: "builder",
					goal: "Build the entire project",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.input.kind).toBe("background")
		if (plan.tasks[0]?.input.kind === "background") {
			expect(plan.tasks[0].input.needsBrowser).toBe(false)
		}
	})
})

describe("materializeRouterOutput — integration read vs write", () => {
	it("read-only integration has no resource locks with write semantics", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Check messages",
			tasks: [
				{
					specialist: "integration",
					goal: "Check Slack messages",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.mutates).toBe(false)
		expect(plan.tasks[0]?.writesExternal).toBe(false)
		expect(plan.tasks[0]?.requiresConfirmation).toBe(false)
	})
})

describe("materializeRouterOutput — settings edge cases", () => {
	it("timezone settings uses goal as fallback when timezone field missing", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Set timezone",
			tasks: [
				{
					specialist: "settings",
					goal: "America/Chicago",
					dependencies: [],
					settingsKind: "timezone",
					// timezone field intentionally omitted
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		const input = plan.tasks[0]?.input
		expect(input?.kind).toBe("settings")
		if (input?.kind === "settings" && input.task.kind === "timezone") {
			expect(input.task.timezone).toBe("America/Chicago")
		}
	})
})

describe("materializeRouterOutput — multiple path hints for builder", () => {
	it("creates per-file resource locks for each path hint", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Fix multiple files",
			tasks: [
				{
					specialist: "builder",
					goal: "Fix billing and invoice",
					dependencies: [],
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, [
			"/src/billing/totals.ts",
			"/src/billing/invoice.ts",
		])
		expect(plan.tasks[0]?.resourceLocks).toContain("fs-write:/src/billing/totals.ts")
		expect(plan.tasks[0]?.resourceLocks).toContain("fs-write:/src/billing/invoice.ts")
		expect(plan.tasks[0]?.resourceLocks).not.toContain("sandbox-workdir:/")
	})
})

describe("materializeRouterOutput — computer defaults", () => {
	it("computer task defaults writesExternally to false", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Check system",
			tasks: [
				{
					specialist: "computer",
					goal: "Check htop",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.writesExternal).toBe(false)
		expect(plan.tasks[0]?.requiresConfirmation).toBe(false)
	})
})
