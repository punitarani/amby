import { describe, expect, it } from "bun:test"
import type { AgentRunConfig } from "../types/agent"
import type { ExecutionPlan } from "../types/execution"
import { materializePlan } from "./coordinator"
import {
	buildRouterPrompt,
	extractPathHints,
	extractUrls,
	materializeRouterOutput,
	type RouterOutput,
} from "./planner"

const stubRuntime: AgentRunConfig["runtime"] = {
	sandboxEnabled: true,
	cuaEnabled: true,
	integrationEnabled: true,
	streamingEnabled: false,
	browserEnabled: true,
}

// ---------------------------------------------------------------------------
// extractUrls
// ---------------------------------------------------------------------------

describe("extractUrls", () => {
	it("extracts full https URLs", () => {
		const urls = extractUrls("Open https://example.com and check it")
		expect(urls).toContain("https://example.com/")
	})

	it("converts bare domains to https URLs", () => {
		const urls = extractUrls("Go to nytimes.com and summarize")
		expect(urls.some((u) => u.includes("nytimes.com"))).toBe(true)
	})

	it("deduplicates URLs", () => {
		const urls = extractUrls("Visit https://example.com and also https://example.com again")
		const unique = urls.filter((u) => u.includes("example.com"))
		expect(unique).toHaveLength(1)
	})

	it("handles multiple different URLs", () => {
		const urls = extractUrls("Compare https://a.com and https://b.com")
		expect(urls.length).toBe(2)
	})

	it("returns empty array for no URLs", () => {
		const urls = extractUrls("Hello, how are you?")
		expect(urls).toHaveLength(0)
	})

	it("does not double-count bare domain already in full URL", () => {
		const urls = extractUrls("Open https://nytimes.com/article and nytimes.com")
		expect(urls).toHaveLength(1)
	})

	it("keeps bare domain when full URL is a different subdomain", () => {
		const urls = extractUrls("Visit https://api.example.com and example.com")
		expect(urls.length).toBe(2)
		expect(urls.some((u) => u.includes("api.example.com"))).toBe(true)
		expect(urls.some((u) => u === "https://example.com/")).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// extractPathHints
// ---------------------------------------------------------------------------

describe("extractPathHints", () => {
	it("extracts file paths", () => {
		const paths = extractPathHints("Fix /src/billing/totals.ts")
		expect(paths).toContain("/src/billing/totals.ts")
	})

	it("deduplicates paths", () => {
		const paths = extractPathHints("Edit /src/foo.ts and also /src/foo.ts")
		expect(paths).toHaveLength(1)
	})

	it("returns empty for no paths", () => {
		const paths = extractPathHints("Hello world")
		expect(paths).toHaveLength(0)
	})

	it("does not extract path segments from URLs", () => {
		const paths = extractPathHints("See https://github.com/user/repo and fix /src/foo.ts")
		expect(paths).toContain("/src/foo.ts")
		expect(paths.some((p) => p.includes("github.com"))).toBe(false)
		expect(paths.some((p) => p.includes("/user/repo"))).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// buildRouterPrompt
// ---------------------------------------------------------------------------

describe("buildRouterPrompt", () => {
	it("includes the request text", () => {
		const prompt = buildRouterPrompt({
			request: "Open nytimes.com",
			urls: ["https://nytimes.com/"],
			pathHints: [],
			runtime: stubRuntime,
		})
		expect(prompt).toContain("Open nytimes.com")
	})

	it("includes detected URLs in context", () => {
		const prompt = buildRouterPrompt({
			request: "Compare two sites",
			urls: ["https://a.com/", "https://b.com/"],
			pathHints: [],
			runtime: stubRuntime,
		})
		expect(prompt).toContain("URLs detected in request:")
		expect(prompt).toContain("https://a.com/")
		expect(prompt).toContain("https://b.com/")
	})

	it("includes detected file paths in context", () => {
		const prompt = buildRouterPrompt({
			request: "Fix /src/foo.ts",
			urls: [],
			pathHints: ["/src/foo.ts"],
			runtime: stubRuntime,
		})
		expect(prompt).toContain("File paths detected")
		expect(prompt).toContain("/src/foo.ts")
	})

	it("marks disabled capabilities", () => {
		const prompt = buildRouterPrompt({
			request: "Test",
			urls: [],
			pathHints: [],
			runtime: { ...stubRuntime, browserEnabled: false, cuaEnabled: false },
		})
		expect(prompt).toContain("Browser: disabled")
		expect(prompt).toContain("Computer Use Agent: disabled")
	})

	it("marks enabled capabilities", () => {
		const prompt = buildRouterPrompt({
			request: "Test",
			urls: [],
			pathHints: [],
			runtime: stubRuntime,
		})
		expect(prompt).toContain("Browser: enabled")
		expect(prompt).toContain("Computer Use Agent: enabled")
		expect(prompt).toContain("Cloud Sandbox (research/builder): enabled")
		expect(prompt).toContain("Integrations (Gmail, Slack, etc.): enabled")
	})

	it("includes specialist descriptions", () => {
		const prompt = buildRouterPrompt({
			request: "Test",
			urls: [],
			pathHints: [],
			runtime: stubRuntime,
		})
		expect(prompt).toContain("### browser")
		expect(prompt).toContain("### computer")
		expect(prompt).toContain("### research")
		expect(prompt).toContain("### builder")
		expect(prompt).toContain("### integration")
		expect(prompt).toContain("### memory")
		expect(prompt).toContain("### settings")
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — direct strategy
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — direct strategy", () => {
	it("returns empty tasks for direct strategy", () => {
		const output: RouterOutput = {
			strategy: "direct",
			rationale: "Simple greeting",
			tasks: [],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.strategy).toBe("direct")
		expect(plan.tasks).toHaveLength(0)
		expect(plan.reducer).toBe("conversation")
	})

	it("returns direct when tasks array is empty regardless of strategy", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "No tasks needed",
			tasks: [],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.strategy).toBe("direct")
		expect(plan.tasks).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — browser tasks
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — browser tasks", () => {
	it("materializes a browser extract task", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Read webpage",
			tasks: [
				{
					specialist: "browser",
					goal: "Summarize the homepage",
					dependencies: [],
					startUrl: "https://nytimes.com/",
					browserMode: "extract",
					sideEffectLevel: "read",
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks).toHaveLength(1)
		expect(plan.tasks[0]?.specialist).toBe("browser")
		expect(plan.tasks[0]?.runnerKind).toBe("browser_service")
		expect(plan.tasks[0]?.mutates).toBe(false)
		expect(plan.tasks[0]?.input.kind).toBe("browser")
		if (plan.tasks[0]?.input.kind === "browser") {
			expect(plan.tasks[0].input.task.mode).toBe("extract")
			expect(plan.tasks[0].input.task.startUrl).toBe("https://nytimes.com/")
			expect(plan.tasks[0].input.task.sideEffectLevel).toBe("read")
		}
	})

	it("materializes a browser agent task with soft-write", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Login to site",
			tasks: [
				{
					specialist: "browser",
					goal: "Log into the account",
					dependencies: [],
					startUrl: "https://app.example.com/",
					browserMode: "agent",
					sideEffectLevel: "soft-write",
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.mutates).toBe(true)
		expect(plan.tasks[0]?.writesExternal).toBe(false)
	})

	it("materializes a browser hard-write task with confirmation", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Purchase item",
			tasks: [
				{
					specialist: "browser",
					goal: "Complete purchase",
					dependencies: [],
					startUrl: "https://shop.example.com/",
					browserMode: "agent",
					sideEffectLevel: "hard-write",
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.mutates).toBe(true)
		expect(plan.tasks[0]?.writesExternal).toBe(true)
		expect(plan.tasks[0]?.requiresConfirmation).toBe(true)
		expect(plan.reducer).toBe("validator")
	})

	it("defaults browser mode to agent and sideEffectLevel to read", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Browse",
			tasks: [
				{
					specialist: "browser",
					goal: "Check the site",
					dependencies: [],
					startUrl: "https://example.com/",
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.input.kind).toBe("browser")
		if (plan.tasks[0]?.input.kind === "browser") {
			expect(plan.tasks[0].input.task.mode).toBe("agent")
			expect(plan.tasks[0].input.task.sideEffectLevel).toBe("read")
		}
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — computer tasks
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — computer tasks", () => {
	it("materializes a computer task with desktop lock", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Desktop interaction needed",
			tasks: [
				{
					specialist: "computer",
					goal: "Open Terminal and run htop",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.specialist).toBe("computer")
		expect(plan.tasks[0]?.runnerKind).toBe("toolloop")
		expect(plan.tasks[0]?.resourceLocks).toContain("computer-desktop")
		expect(plan.tasks[0]?.mutates).toBe(true)
	})

	it("sets writesExternal when writesExternally is true", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Cross-site transfer",
			tasks: [
				{
					specialist: "computer",
					goal: "Download from A, upload to B",
					dependencies: [],
					writesExternally: true,
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.writesExternal).toBe(true)
		expect(plan.tasks[0]?.requiresConfirmation).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — research tasks
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — research tasks", () => {
	it("materializes a research task as read-only", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Investigation needed",
			tasks: [
				{
					specialist: "research",
					goal: "Analyze the auth middleware",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.specialist).toBe("research")
		expect(plan.tasks[0]?.mutates).toBe(false)
		expect(plan.tasks[0]?.resourceLocks).toHaveLength(0)
		expect(plan.reducer).toBe("conversation")
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — builder tasks
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — builder tasks", () => {
	it("materializes a builder task with sandbox locks", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Code changes needed",
			tasks: [
				{
					specialist: "builder",
					goal: "Implement login form",
					dependencies: [],
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.specialist).toBe("builder")
		expect(plan.tasks[0]?.mutates).toBe(true)
		expect(plan.tasks[0]?.requiresValidation).toBe(true)
		expect(plan.tasks[0]?.resourceLocks).toContain("sandbox-workdir:/")
		expect(plan.reducer).toBe("validator")
	})

	it("uses path hints as resource locks when present", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Fix specific file",
			tasks: [
				{
					specialist: "builder",
					goal: "Fix the bug in totals.ts",
					dependencies: [],
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, ["/src/billing/totals.ts"])
		expect(plan.tasks[0]?.resourceLocks).toContain("fs-write:/src/billing/totals.ts")
		expect(plan.tasks[0]?.resourceLocks).not.toContain("sandbox-workdir:/")
	})

	it("includes pathHints in builder task payload", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Fix file",
			tasks: [
				{
					specialist: "builder",
					goal: "Fix it",
					dependencies: [],
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, ["/src/foo.ts"])
		const input = plan.tasks[0]?.input
		expect(input?.kind).toBe("specialist")
		if (input?.kind === "specialist") {
			expect((input.payload as Record<string, unknown>).pathHints).toEqual(["/src/foo.ts"])
		}
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — integration tasks
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — integration tasks", () => {
	it("materializes a read-only integration task", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Check email",
			tasks: [
				{
					specialist: "integration",
					goal: "Check Gmail for new messages",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.specialist).toBe("integration")
		expect(plan.tasks[0]?.mutates).toBe(false)
		expect(plan.tasks[0]?.writesExternal).toBe(false)
	})

	it("materializes a write integration task with confirmation", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Send email",
			tasks: [
				{
					specialist: "integration",
					goal: "Send email to team",
					dependencies: [],
					writesExternally: true,
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.mutates).toBe(true)
		expect(plan.tasks[0]?.writesExternal).toBe(true)
		expect(plan.tasks[0]?.requiresConfirmation).toBe(true)
		expect(plan.tasks[0]?.requiresValidation).toBe(true)
		expect(plan.reducer).toBe("validator")
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — memory tasks
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — memory tasks", () => {
	it("materializes a memory task with write lock", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Save memory",
			tasks: [
				{
					specialist: "memory",
					goal: "Remember favorite color is blue",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.specialist).toBe("memory")
		expect(plan.tasks[0]?.mutates).toBe(true)
		expect(plan.tasks[0]?.resourceLocks).toContain("memory-write")
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — settings tasks
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — settings tasks", () => {
	it("materializes a timezone settings task", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Set timezone",
			tasks: [
				{
					specialist: "settings",
					goal: "Set timezone to America/New_York",
					dependencies: [],
					settingsKind: "timezone",
					timezone: "America/New_York",
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.specialist).toBe("settings")
		expect(plan.tasks[0]?.mutates).toBe(true)
		const input = plan.tasks[0]?.input
		expect(input?.kind).toBe("settings")
		if (input?.kind === "settings") {
			expect(input.task).toEqual({ kind: "timezone", timezone: "America/New_York" })
		}
	})

	it("materializes a schedule settings task", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Create reminder",
			tasks: [
				{
					specialist: "settings",
					goal: "Remind me to check deploy every Monday",
					dependencies: [],
					settingsKind: "schedule",
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		const input = plan.tasks[0]?.input
		expect(input?.kind).toBe("settings")
		if (input?.kind === "settings") {
			expect(input.task.kind).toBe("schedule")
		}
	})

	it("materializes a codex_auth settings task", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Auth setup",
			tasks: [
				{
					specialist: "settings",
					goal: "Check codex auth status",
					dependencies: [],
					settingsKind: "codex_auth",
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		const input = plan.tasks[0]?.input
		expect(input?.kind).toBe("settings")
		if (input?.kind === "settings") {
			expect(input.task.kind).toBe("codex_auth")
		}
	})

	it("falls back to specialist input when settingsKind is missing", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Settings",
			tasks: [
				{
					specialist: "settings",
					goal: "Handle some setting",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks[0]?.input.kind).toBe("specialist")
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — background tasks
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — background tasks", () => {
	it("materializes a background task with background_handoff runner", () => {
		const output: RouterOutput = {
			strategy: "background",
			rationale: "Long-running autonomous work",
			tasks: [
				{
					specialist: "builder",
					goal: "Set up the entire project",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.strategy).toBe("background")
		expect(plan.tasks).toHaveLength(1)
		expect(plan.tasks[0]?.runnerKind).toBe("background_handoff")
		expect(plan.tasks[0]?.mode).toBe("background")
	})

	it("returns direct when background strategy has no tasks", () => {
		const output: RouterOutput = {
			strategy: "background",
			rationale: "No tasks",
			tasks: [],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.strategy).toBe("direct")
		expect(plan.tasks).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — parallel strategy
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — parallel strategy", () => {
	it("materializes parallel browser tasks", () => {
		const output: RouterOutput = {
			strategy: "parallel",
			rationale: "Compare two sites",
			tasks: [
				{
					specialist: "browser",
					goal: "Extract content from site A",
					dependencies: [],
					startUrl: "https://a.com/",
					browserMode: "extract",
					sideEffectLevel: "read",
				},
				{
					specialist: "browser",
					goal: "Extract content from site B",
					dependencies: [],
					startUrl: "https://b.com/",
					browserMode: "extract",
					sideEffectLevel: "read",
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.strategy).toBe("parallel")
		expect(plan.tasks).toHaveLength(2)
		expect(plan.tasks.every((t) => t.specialist === "browser")).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — sequential with dependencies
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — sequential with dependencies", () => {
	it("preserves task-N dependency references", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Research then build",
			tasks: [
				{
					specialist: "research",
					goal: "Investigate the codebase",
					dependencies: [],
				},
				{
					specialist: "builder",
					goal: "Fix the bug",
					dependencies: ["task-0"],
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.tasks).toHaveLength(2)
		expect(plan.tasks[0]?.specialist).toBe("research")
		expect(plan.tasks[1]?.specialist).toBe("builder")
		expect(plan.tasks[1]?.dependencies).toContain("task-0")
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — validation flag
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — validation flag", () => {
	it("sets reducer to validator when needsValidation is true", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Needs review",
			tasks: [
				{
					specialist: "builder",
					goal: "Edit code",
					dependencies: [],
				},
			],
			needsValidation: true,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.reducer).toBe("validator")
	})

	it("sets reducer to conversation when needsValidation is false", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "Read-only",
			tasks: [
				{
					specialist: "research",
					goal: "Investigate",
					dependencies: [],
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.reducer).toBe("conversation")
	})
})

// ---------------------------------------------------------------------------
// materializeRouterOutput — rationale passthrough
// ---------------------------------------------------------------------------

describe("materializeRouterOutput — rationale", () => {
	it("passes rationale through to the execution plan", () => {
		const output: RouterOutput = {
			strategy: "sequential",
			rationale: "The user wants to browse a specific URL",
			tasks: [
				{
					specialist: "browser",
					goal: "Read page",
					dependencies: [],
					startUrl: "https://example.com/",
					browserMode: "extract",
					sideEffectLevel: "read",
				},
			],
			needsValidation: false,
		}
		const plan = materializeRouterOutput(output, [])
		expect(plan.rationale).toBe("The user wants to browse a specific URL")
	})
})

// ---------------------------------------------------------------------------
// materializePlan (coordinator) — still works with router-produced plans
// ---------------------------------------------------------------------------

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
