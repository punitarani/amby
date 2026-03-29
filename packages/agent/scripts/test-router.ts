#!/usr/bin/env bun
/**
 * Manual test script for the LLM router preprocessing and materialization.
 * Exercises extractUrls, extractPathHints, buildRouterPrompt, and materializeRouterOutput
 * without needing an LLM call.
 *
 * Usage: bun packages/agent/scripts/test-router.ts
 */

import {
	buildRouterPrompt,
	extractPathHints,
	extractUrls,
	materializeRouterOutput,
	type RouterOutput,
} from "../src/execution/planner"
import type { AgentRunConfig } from "../src/types/agent"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runtime: AgentRunConfig["runtime"] = {
	sandboxEnabled: true,
	cuaEnabled: true,
	integrationEnabled: true,
	browserEnabled: true,
}

function section(title: string) {
	console.log(`\n${"=".repeat(60)}`)
	console.log(` ${title}`)
	console.log("=".repeat(60))
}

function testCase(label: string, fn: () => void) {
	try {
		fn()
		console.log(`  ✓ ${label}`)
	} catch (e) {
		console.error(`  ✗ ${label}`)
		console.error(`    ${e}`)
		process.exitCode = 1
	}
}

function assert(condition: boolean, message: string) {
	if (!condition) throw new Error(message)
}

// ---------------------------------------------------------------------------
// extractUrls
// ---------------------------------------------------------------------------

section("extractUrls")

testCase("full URL", () => {
	const urls = extractUrls("Open https://example.com and check it")
	assert(urls.includes("https://example.com/"), `expected https://example.com/, got ${urls}`)
})

testCase("bare domain", () => {
	const urls = extractUrls("Go to nytimes.com")
	assert(
		urls.some((u) => u.includes("nytimes.com")),
		`expected nytimes.com in ${urls}`,
	)
})

testCase("deduplication", () => {
	const urls = extractUrls("Visit https://example.com and https://example.com again")
	assert(urls.length === 1, `expected 1, got ${urls.length}`)
})

testCase("bare domain NOT suppressed by different subdomain", () => {
	const urls = extractUrls("Visit https://api.example.com and example.com")
	assert(urls.length === 2, `expected 2, got ${urls.length}: ${urls}`)
})

testCase("bare domain suppressed when same hostname in full URL", () => {
	const urls = extractUrls("Open https://nytimes.com/article and nytimes.com")
	assert(urls.length === 1, `expected 1, got ${urls.length}: ${urls}`)
})

testCase("no URLs", () => {
	const urls = extractUrls("Hello, how are you?")
	assert(urls.length === 0, `expected 0, got ${urls.length}`)
})

// ---------------------------------------------------------------------------
// extractPathHints
// ---------------------------------------------------------------------------

section("extractPathHints")

testCase("file paths", () => {
	const paths = extractPathHints("Fix /src/billing/totals.ts")
	assert(paths.includes("/src/billing/totals.ts"), `expected /src/billing/totals.ts in ${paths}`)
})

testCase("ignores URL path segments", () => {
	const paths = extractPathHints("See https://github.com/user/repo and fix /src/foo.ts")
	assert(paths.includes("/src/foo.ts"), `expected /src/foo.ts in ${paths}`)
	assert(!paths.some((p) => p.includes("github")), `should not contain github path, got ${paths}`)
})

testCase("no paths", () => {
	const paths = extractPathHints("Hello world")
	assert(paths.length === 0, `expected 0, got ${paths.length}`)
})

// ---------------------------------------------------------------------------
// buildRouterPrompt
// ---------------------------------------------------------------------------

section("buildRouterPrompt")

testCase("includes request, URLs, capabilities", () => {
	const prompt = buildRouterPrompt({
		request: "Summarize https://nytimes.com",
		urls: ["https://nytimes.com/"],
		pathHints: [],
		runtime,
	})
	assert(prompt.includes("Summarize https://nytimes.com"), "missing request")
	assert(prompt.includes("URLs detected"), "missing URLs section")
	assert(prompt.includes("Browser: enabled"), "missing browser capability")
})

testCase("disabled capabilities shown", () => {
	const prompt = buildRouterPrompt({
		request: "Test",
		urls: [],
		pathHints: [],
		runtime: { ...runtime, browserEnabled: false },
	})
	assert(prompt.includes("Browser: disabled"), "should show browser disabled")
})

// ---------------------------------------------------------------------------
// materializeRouterOutput
// ---------------------------------------------------------------------------

section("materializeRouterOutput")

testCase("direct strategy → empty tasks", () => {
	const plan = materializeRouterOutput(
		{ strategy: "direct", rationale: "chat", tasks: [], needsValidation: false },
		[],
	)
	assert(plan.strategy === "direct", `expected direct, got ${plan.strategy}`)
	assert(plan.tasks.length === 0, `expected 0 tasks, got ${plan.tasks.length}`)
})

testCase("browser extract task", () => {
	const output: RouterOutput = {
		strategy: "sequential",
		rationale: "Read page",
		tasks: [
			{
				specialist: "browser",
				goal: "Summarize",
				dependencies: [],
				startUrl: "https://nytimes.com/",
				browserMode: "extract",
				sideEffectLevel: "read",
			},
		],
		needsValidation: false,
	}
	const plan = materializeRouterOutput(output, [])
	assert(plan.tasks[0]?.specialist === "browser", "expected browser specialist")
	assert(plan.tasks[0]?.mutates === false, "extract should not mutate")
	if (plan.tasks[0]?.input.kind === "browser") {
		assert(plan.tasks[0].input.task.mode === "extract", "expected extract mode")
		assert(
			plan.tasks[0].input.task.startUrl === "https://nytimes.com/",
			"expected nytimes startUrl",
		)
	}
})

testCase("research → builder sequential with dependencies", () => {
	const output: RouterOutput = {
		strategy: "sequential",
		rationale: "Research then build",
		tasks: [
			{ specialist: "research", goal: "Investigate", dependencies: [] },
			{ specialist: "builder", goal: "Fix bug", dependencies: ["task-0"] },
		],
		needsValidation: true,
	}
	const plan = materializeRouterOutput(output, ["/src/foo.ts"])
	assert(plan.tasks.length === 2, `expected 2 tasks, got ${plan.tasks.length}`)
	assert(plan.tasks[0]?.specialist === "research", "first should be research")
	assert(plan.tasks[1]?.specialist === "builder", "second should be builder")
	assert(plan.tasks[1]?.dependencies.includes("task-0"), "builder should depend on task-0")
	assert(plan.tasks[1]?.resourceLocks.includes("fs-write:/src/foo.ts"), "should have fs-write lock")
	assert(plan.reducer === "validator", "should use validator reducer")
})

testCase("background strategy", () => {
	const output: RouterOutput = {
		strategy: "background",
		rationale: "Long task",
		tasks: [{ specialist: "builder", goal: "Set up project", dependencies: [] }],
		needsValidation: false,
	}
	const plan = materializeRouterOutput(output, [])
	assert(plan.strategy === "background", `expected background, got ${plan.strategy}`)
	assert(plan.tasks[0]?.runnerKind === "background_handoff", "expected background_handoff runner")
})

testCase("integration with external writes", () => {
	const output: RouterOutput = {
		strategy: "sequential",
		rationale: "Send email",
		tasks: [
			{
				specialist: "integration",
				goal: "Send email",
				dependencies: [],
				writesExternally: true,
			},
		],
		needsValidation: true,
	}
	const plan = materializeRouterOutput(output, [])
	assert(plan.tasks[0]?.writesExternal === true, "should write externally")
	assert(plan.tasks[0]?.requiresConfirmation === true, "should require confirmation")
	assert(plan.reducer === "validator", "should use validator")
})

testCase("settings timezone", () => {
	const output: RouterOutput = {
		strategy: "sequential",
		rationale: "Set tz",
		tasks: [
			{
				specialist: "settings",
				goal: "Set timezone",
				dependencies: [],
				settingsKind: "timezone",
				timezone: "America/New_York",
			},
		],
		needsValidation: false,
	}
	const plan = materializeRouterOutput(output, [])
	assert(plan.tasks[0]?.input.kind === "settings", "expected settings input")
	if (plan.tasks[0]?.input.kind === "settings") {
		assert(plan.tasks[0].input.task.kind === "timezone", "expected timezone kind")
	}
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

section("Done")
console.log(process.exitCode ? "\nSome tests failed." : "\nAll tests passed.")
