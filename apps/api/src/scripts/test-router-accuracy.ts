#!/usr/bin/env bun

/**
 * Router accuracy & performance benchmark.
 *
 * Sends a battery of prompts through the full agent pipeline and checks
 * whether the LLM router picks the expected specialist(s). Measures
 * latency per routing decision and reports accuracy per category.
 *
 * NOTE: Browser is disabled in this runtime (BrowserServiceDisabledLive),
 * so browser-intended prompts should fall back to computer.
 *
 * Usage: doppler run -- bun run src/scripts/test-router-accuracy.ts
 */

import type { AgentRunResult } from "@amby/agent"
import {
	ConversationRuntime,
	makeConversationRuntimeLive,
	makeModelServiceLive,
	ROUTER_MODEL_ID,
} from "@amby/agent"
import { AuthServiceLive } from "@amby/auth"
import { BrowserServiceDisabledLive } from "@amby/browser/local"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import {
	and,
	ComputeStoreLive,
	DbService,
	DbServiceLive,
	eq,
	schema,
	TaskStoreLive,
	TraceStoreLive,
} from "@amby/db"
import { EnvServiceLive, makeEffectDevToolsLive } from "@amby/env/local"
import { AutomationServiceLive } from "@amby/plugins"
import { ConnectorsServiceLive } from "@amby/plugins/integrations"
import { MemoryServiceLive } from "@amby/plugins/memory"
import { PluginRegistryLive } from "@amby/plugins/registry"
import { Effect, Layer, ManagedRuntime } from "effect"

// ---------------------------------------------------------------------------
// Test case definitions
// ---------------------------------------------------------------------------

type RoutingExpectation = {
	/** Human-readable label */
	label: string
	/** The message to send */
	prompt: string
	/** Which specialist(s) must appear (OR — any match passes) */
	expectAnySpecialist: string[]
	/** Expected execution mode (null = don't check) */
	expectMode: string | null
	/** Category for grouping in the report */
	category: string
}

// Browser is disabled in this test runtime, so browser prompts should
// fall back to computer. Tests accept both.
const BROWSER_OR_COMPUTER = ["browser", "computer"]

const TEST_CASES: RoutingExpectation[] = [
	// --- Direct (no specialist) ---
	{
		label: "greeting",
		prompt: "Hello! How are you?",
		expectAnySpecialist: [],
		expectMode: "direct",
		category: "direct",
	},
	{
		label: "simple factual question",
		prompt: "What is the capital of France?",
		expectAnySpecialist: [],
		expectMode: "direct",
		category: "direct",
	},
	{
		label: "opinion question",
		prompt: "What do you think about TypeScript?",
		expectAnySpecialist: [],
		expectMode: "direct",
		category: "direct",
	},
	{
		label: "math question",
		prompt: "What is 247 times 83?",
		expectAnySpecialist: [],
		expectMode: "direct",
		category: "direct",
	},

	// --- Memory ---
	{
		label: "remember a fact",
		prompt: "Remember this: my favorite color is blue",
		expectAnySpecialist: ["memory"],
		expectMode: null,
		category: "memory",
	},
	{
		label: "remember preference",
		prompt: "Save this for later: I prefer dark mode in all my apps",
		expectAnySpecialist: ["memory"],
		expectMode: null,
		category: "memory",
	},
	{
		label: "recall saved info",
		prompt: "Look up what my favorite color is from my saved memories",
		expectAnySpecialist: ["memory"],
		expectMode: null,
		category: "memory",
	},

	// --- Research ---
	{
		label: "investigate files",
		prompt: "Investigate the file structure under /src/components and list all React components",
		expectAnySpecialist: ["research"],
		expectMode: null,
		category: "research",
	},
	{
		label: "read-only shell command",
		prompt: "Run ls -la in the project root and show me the output",
		expectAnySpecialist: ["research"],
		expectMode: null,
		category: "research",
	},
	{
		label: "analyze code",
		prompt: "Analyze the authentication middleware and explain how it validates tokens",
		expectAnySpecialist: ["research"],
		expectMode: null,
		category: "research",
	},
	{
		label: "grep codebase",
		prompt: "Search the codebase for all usages of the deprecated fetchUser function",
		expectAnySpecialist: ["research"],
		expectMode: null,
		category: "research",
	},

	// --- Builder ---
	{
		label: "implement feature",
		prompt: "Implement a new login form component in /src/components/LoginForm.tsx",
		expectAnySpecialist: ["builder"],
		expectMode: null,
		category: "builder",
	},
	{
		label: "fix bug",
		prompt: "Fix the bug in /src/utils/dates.ts where timezone conversion is off by one hour",
		expectAnySpecialist: ["builder"],
		expectMode: null,
		category: "builder",
	},
	{
		label: "refactor code",
		prompt: "Refactor the user service to use dependency injection instead of global imports",
		expectAnySpecialist: ["builder"],
		expectMode: null,
		category: "builder",
	},
	{
		label: "create test file",
		prompt: "Write unit tests for the billing module in /src/billing/__tests__/totals.test.ts",
		expectAnySpecialist: ["builder"],
		expectMode: null,
		category: "builder",
	},

	// --- Settings ---
	{
		label: "set timezone",
		prompt: "Set my timezone to Europe/London",
		expectAnySpecialist: ["settings"],
		expectMode: null,
		category: "settings",
	},
	{
		label: "create reminder",
		prompt: "Remind me every Monday at 9am to check the deploy dashboard",
		expectAnySpecialist: ["settings"],
		expectMode: null,
		category: "settings",
	},
	{
		label: "set timezone (implicit)",
		prompt: "I'm in Tokyo, update my timezone",
		expectAnySpecialist: ["settings"],
		expectMode: null,
		category: "settings",
	},

	// --- Integration ---
	{
		label: "check email",
		prompt: "Check my Gmail for any unread messages from today",
		expectAnySpecialist: ["integration"],
		expectMode: null,
		category: "integration",
	},
	{
		label: "send slack",
		prompt: "Send a message to the #general channel on Slack saying the deploy is complete",
		expectAnySpecialist: ["integration"],
		expectMode: null,
		category: "integration",
	},
	{
		label: "create calendar event",
		prompt: "Add a meeting to my Google Calendar for tomorrow at 2pm with the design team",
		expectAnySpecialist: ["integration"],
		expectMode: null,
		category: "integration",
	},
	{
		label: "read notion",
		prompt: "Pull up the project roadmap from Notion and summarize the Q2 milestones",
		expectAnySpecialist: ["integration"],
		expectMode: null,
		category: "integration",
	},

	// --- Browser (falls back to computer when disabled) ---
	{
		label: "summarize webpage",
		prompt: "Summarize the homepage of https://news.ycombinator.com",
		expectAnySpecialist: BROWSER_OR_COMPUTER,
		expectMode: null,
		category: "browser",
	},
	{
		label: "extract page content",
		prompt: "Go to https://docs.example.com/api and extract the API reference",
		expectAnySpecialist: BROWSER_OR_COMPUTER,
		expectMode: null,
		category: "browser",
	},
	{
		label: "fill web form",
		prompt: "Fill in the contact form at https://example.com/contact with my name and email",
		expectAnySpecialist: BROWSER_OR_COMPUTER,
		expectMode: null,
		category: "browser",
	},
	{
		label: "login to site",
		prompt: "Log into https://dashboard.example.com with my saved credentials",
		expectAnySpecialist: BROWSER_OR_COMPUTER,
		expectMode: null,
		category: "browser",
	},
	{
		label: "compare two URLs (parallel)",
		prompt:
			"Compare the pricing pages of https://serviceA.com/pricing and https://serviceB.com/pricing",
		expectAnySpecialist: BROWSER_OR_COMPUTER,
		expectMode: "parallel",
		category: "browser",
	},

	// --- Computer Use Agent ---
	{
		label: "open desktop app",
		prompt: "Open the Terminal application and run htop",
		expectAnySpecialist: ["computer"],
		expectMode: null,
		category: "computer",
	},
	{
		label: "cross-app workflow",
		prompt: "Download the report from https://analytics.example.com/export and open it in Excel",
		expectAnySpecialist: ["computer"],
		expectMode: null,
		category: "computer",
	},
	{
		label: "system monitoring",
		prompt: "Check disk space usage and show me which directories are using the most storage",
		expectAnySpecialist: ["computer"],
		expectMode: null,
		category: "computer",
	},
	{
		label: "file picker interaction",
		prompt: "Use the file picker dialog to select a photo from my Desktop and upload it",
		expectAnySpecialist: ["computer"],
		expectMode: null,
		category: "computer",
	},
	{
		label: "multi-site with desktop",
		prompt:
			"Download a CSV from https://data.example.com, then import it into the SQLite database using the terminal",
		expectAnySpecialist: ["computer"],
		expectMode: null,
		category: "computer",
	},

	// --- Compound / Sequential ---
	{
		label: "research then build",
		prompt:
			"Investigate the current error handling patterns in /src/api, then refactor them to use a unified error class",
		expectAnySpecialist: ["research", "builder"],
		expectMode: "sequential",
		category: "compound",
	},
	{
		label: "research then fix",
		prompt: "First analyze why the test suite is failing, then fix the broken tests",
		expectAnySpecialist: ["research", "builder"],
		expectMode: "sequential",
		category: "compound",
	},

	// --- Edge cases / Ambiguous ---
	{
		label: "bare domain (should be web)",
		prompt: "What's on the front page of reddit.com right now?",
		expectAnySpecialist: BROWSER_OR_COMPUTER,
		expectMode: null,
		category: "edge",
	},
	{
		label: "ambiguous: could be direct or research",
		prompt: "How does the auth middleware work in this project?",
		expectAnySpecialist: ["research"],
		expectMode: null,
		category: "edge",
	},
	{
		label: "check saved setting",
		prompt: "Look up what timezone I have saved in my settings",
		expectAnySpecialist: ["memory", "settings"],
		expectMode: null,
		category: "edge",
	},
]

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const modelArg = process.argv.find((a) => a.startsWith("--model="))?.split("=")[1]

// ---------------------------------------------------------------------------
// Runtime setup (same as test-telegram-flow.ts)
// ---------------------------------------------------------------------------

const SIMULATED_TELEGRAM_USER_ID = 99999998
const SIMULATED_CHAT_ID = 99999998

const StoreLive = Layer.mergeAll(TaskStoreLive, TraceStoreLive, ComputeStoreLive).pipe(
	Layer.provideMerge(DbServiceLive),
)
const InfraLive = Layer.mergeAll(makeEffectDevToolsLive(), SandboxServiceLive).pipe(
	Layer.provideMerge(StoreLive),
	Layer.provideMerge(EnvServiceLive),
)

const ServicesLive = Layer.mergeAll(
	MemoryServiceLive,
	AutomationServiceLive,
	TaskSupervisorLive,
	makeModelServiceLive(modelArg),
	AuthServiceLive,
	ConnectorsServiceLive,
	BrowserServiceDisabledLive,
).pipe(Layer.provideMerge(InfraLive))
const SharedLive = PluginRegistryLive.pipe(Layer.provideMerge(ServicesLive))

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type TestResult = {
	label: string
	category: string
	passed: boolean
	expectedSpecialists: string[]
	actualSpecialists: string[]
	expectedMode: string | null
	actualMode: string
	latencyMs: number
	error?: string
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const activeModel = modelArg ?? ROUTER_MODEL_ID
	console.log("\n🎯 Router Accuracy & Performance Benchmark\n")
	console.log(`   Model:      ${activeModel}`)
	console.log(
		`   Test cases: ${TEST_CASES.length} across ${new Set(TEST_CASES.map((t) => t.category)).size} categories`,
	)
	console.log(`   Browser:    disabled (falls back to computer)`)
	console.log("")

	const runtime = ManagedRuntime.make(SharedLive)

	// --- Setup: create user & conversation ---
	const userId = await runtime.runPromise(
		Effect.gen(function* () {
			const { query } = yield* DbService
			const existing = yield* query((db) =>
				db
					.select({ userId: schema.accounts.userId })
					.from(schema.accounts)
					.where(
						and(
							eq(schema.accounts.providerId, "telegram"),
							eq(schema.accounts.accountId, String(SIMULATED_TELEGRAM_USER_ID)),
						),
					)
					.limit(1),
			)
			if (existing[0]) return existing[0].userId

			const id = crypto.randomUUID()
			yield* query((db) =>
				db.transaction(async (tx) => {
					await tx.insert(schema.users).values({ id, name: "Router Bench", timezone: "UTC" })
					await tx.insert(schema.accounts).values({
						id: crypto.randomUUID(),
						userId: id,
						accountId: String(SIMULATED_TELEGRAM_USER_ID),
						providerId: "telegram",
						metadata: {
							chatId: SIMULATED_CHAT_ID,
							username: null,
							firstName: "Router",
							lastName: "Bench",
							languageCode: "en",
							isPremium: false,
						},
					})
				}),
			)
			return id
		}),
	)

	const conversationId = await runtime.runPromise(
		Effect.gen(function* () {
			const agent = yield* ConversationRuntime
			return yield* agent.ensureConversation("telegram", String(SIMULATED_CHAT_ID))
		}).pipe(Effect.provide(makeConversationRuntimeLive(userId))),
	)

	console.log(`   User: ${userId.slice(0, 8)}…  Conversation: ${conversationId.slice(0, 8)}…\n`)

	// --- Run test cases ---
	const results: TestResult[] = []

	for (let i = 0; i < TEST_CASES.length; i++) {
		const tc = TEST_CASES[i]
		if (!tc) continue
		const num = String(i + 1).padStart(2, " ")
		process.stdout.write(`  [${num}/${TEST_CASES.length}] ${tc.category.padEnd(12)} ${tc.label}… `)

		const start = performance.now()
		let result: AgentRunResult
		try {
			result = await runtime.runPromise(
				Effect.gen(function* () {
					const agent = yield* ConversationRuntime
					return yield* agent.handleMessage(conversationId, tc.prompt)
				}).pipe(Effect.provide(makeConversationRuntimeLive(userId))),
			)
		} catch (err) {
			const latencyMs = Math.round(performance.now() - start)
			results.push({
				label: tc.label,
				category: tc.category,
				passed: false,
				expectedSpecialists: tc.expectAnySpecialist,
				actualSpecialists: [],
				expectedMode: tc.expectMode,
				actualMode: "error",
				latencyMs,
				error: err instanceof Error ? err.message : String(err),
			})
			console.log(`❌ ERROR (${latencyMs}ms)`)
			continue
		}
		const latencyMs = Math.round(performance.now() - start)

		const actualSpecialists = result.execution.tasks.map((t) => t.specialist)
		const actualMode = result.execution.mode

		// Check specialist match
		let specialistOk: boolean
		if (tc.expectAnySpecialist.length === 0) {
			// Expect no specialists (direct)
			specialistOk = actualSpecialists.length === 0
		} else {
			// At least one expected specialist must appear
			specialistOk = tc.expectAnySpecialist.some((s) => actualSpecialists.includes(s as never))
		}

		// Check mode match
		const modeOk = tc.expectMode === null || actualMode === tc.expectMode

		const passed = specialistOk && modeOk

		results.push({
			label: tc.label,
			category: tc.category,
			passed,
			expectedSpecialists: tc.expectAnySpecialist,
			actualSpecialists,
			expectedMode: tc.expectMode,
			actualMode,
			latencyMs,
			error: !passed
				? `specialists=[${actualSpecialists.join(",")}] mode=${actualMode}`
				: undefined,
		})

		console.log(
			`${passed ? "✅" : "❌"} ${actualMode.padEnd(12)} [${actualSpecialists.join(", ") || "none"}] (${latencyMs}ms)`,
		)
	}

	// --- Category breakdown ---
	console.log(`\n${"=".repeat(72)}`)
	console.log("  ACCURACY BY CATEGORY")
	console.log("=".repeat(72))

	const categories = [...new Set(TEST_CASES.map((t) => t.category))]
	const categoryStats: { category: string; total: number; passed: number; avgMs: number }[] = []

	for (const cat of categories) {
		const catResults = results.filter((r) => r.category === cat)
		const passed = catResults.filter((r) => r.passed).length
		const total = catResults.length
		const avgMs = Math.round(catResults.reduce((s, r) => s + r.latencyMs, 0) / total)
		const pct = Math.round((passed / total) * 100)
		const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5))
		categoryStats.push({ category: cat, total, passed, avgMs })

		console.log(`\n  ${cat.padEnd(14)} ${bar} ${pct}% (${passed}/${total})  avg ${avgMs}ms`)
		for (const r of catResults) {
			const icon = r.passed ? "✅" : "❌"
			const detail = r.passed ? "" : `  ← got [${r.actualSpecialists.join(",")}] ${r.actualMode}`
			console.log(`    ${icon} ${r.label}${detail}`)
		}
	}

	// --- Overall summary ---
	const totalPassed = results.filter((r) => r.passed).length
	const totalCount = results.length
	const overallPct = Math.round((totalPassed / totalCount) * 100)
	const totalAvgMs = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / totalCount)
	const p50 = results.map((r) => r.latencyMs).sort((a, b) => a - b)[Math.floor(totalCount / 2)]
	const p95 = results.map((r) => r.latencyMs).sort((a, b) => a - b)[Math.floor(totalCount * 0.95)]
	const maxMs = Math.max(...results.map((r) => r.latencyMs))
	const minMs = Math.min(...results.map((r) => r.latencyMs))

	console.log(`\n${"=".repeat(72)}`)
	console.log("  OVERALL RESULTS")
	console.log("=".repeat(72))
	console.log(`\n  Accuracy:    ${totalPassed}/${totalCount} (${overallPct}%)`)
	console.log(`  Latency avg: ${totalAvgMs}ms`)
	console.log(`  Latency p50: ${p50}ms`)
	console.log(`  Latency p95: ${p95}ms`)
	console.log(`  Latency min: ${minMs}ms  max: ${maxMs}ms`)

	// --- Failures detail ---
	const failures = results.filter((r) => !r.passed)
	if (failures.length > 0) {
		console.log(`\n${"=".repeat(72)}`)
		console.log("  FAILURES")
		console.log("=".repeat(72))
		for (const f of failures) {
			console.log(`\n  ❌ [${f.category}] ${f.label}`)
			console.log(`     Prompt:    "${f.label}"`)
			console.log(
				`     Expected:  specialists=${JSON.stringify(f.expectedSpecialists)} mode=${f.expectedMode ?? "any"}`,
			)
			console.log(
				`     Actual:    specialists=[${f.actualSpecialists.join(", ")}] mode=${f.actualMode}`,
			)
		}
	}

	console.log("")

	// --- Cleanup ---
	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				const { query } = yield* DbService
				yield* query((db) =>
					db.delete(schema.tasks).where(eq(schema.tasks.conversationId, conversationId)),
				)
				yield* query((db) =>
					db.delete(schema.runs).where(eq(schema.runs.conversationId, conversationId)),
				)
				yield* query((db) =>
					db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId)),
				)
				yield* query((db) =>
					db
						.delete(schema.conversationThreads)
						.where(eq(schema.conversationThreads.conversationId, conversationId)),
				)
				yield* query((db) =>
					db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId)),
				)
				yield* query((db) => db.delete(schema.memories).where(eq(schema.memories.userId, userId)))
				yield* query((db) => db.delete(schema.accounts).where(eq(schema.accounts.userId, userId)))
				yield* query((db) => db.delete(schema.users).where(eq(schema.users.id, userId)))
			}),
		)
		console.log("  🧹 Test data cleaned up\n")
	} catch (err) {
		console.log(`  ⚠️ Cleanup failed: ${err instanceof Error ? err.message : String(err)}\n`)
	}

	await runtime.dispose()
	process.exit(failures.length > 0 ? 1 : 0)
}

main().catch((err) => {
	console.error("Fatal:", err)
	process.exit(1)
})
