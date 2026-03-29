/**
 * Local simulation of the Telegram → Agent flow.
 *
 * Bypasses wrangler, Cloudflare Durable Objects, Workflows, and Queues.
 * Runs against the local Postgres DB directly using the same runtime
 * layers as apps/api/src/index.ts (local bun dev mode).
 *
 * Usage: doppler run -- bun run scripts/test-telegram-flow.ts
 */

import { ConversationRuntime, ModelServiceLive, makeConversationRuntimeLive } from "@amby/agent"
import { makeAttachmentServicesLocal } from "@amby/attachments/local"
import { AuthLive, TELEGRAM_PROVIDER_ID } from "@amby/auth"
import { BrowserServiceDisabledLive } from "@amby/browser/local"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import {
	and,
	CodexAuthStoreLive,
	ComputeStoreLive,
	DbService,
	DbServiceLive,
	eq,
	schema,
	TaskStoreLive,
	TraceStoreLive,
	VaultStoreLive,
} from "@amby/db"
import { EnvServiceLive, makeEffectDevToolsLive } from "@amby/env/local"
import { AutomationServiceLive } from "@amby/plugins"
import { ConnectorsServiceLive } from "@amby/plugins/integrations"
import { MemoryServiceLive } from "@amby/plugins/memory"
import { PluginRegistryLive } from "@amby/plugins/registry"
import { CodexVaultServiceLive, VaultServiceLive } from "@amby/vault"
import { Effect, Layer, ManagedRuntime } from "effect"

// --- Test Configuration ---

const SIMULATED_TELEGRAM_USER_ID = 99999999 // Fake Telegram user ID
const SIMULATED_CHAT_ID = 99999999
const SIMULATED_FROM = {
	id: SIMULATED_TELEGRAM_USER_ID,
	first_name: "Test",
	last_name: "User",
	language_code: "en",
}

// --- Runtime Setup (mirrors apps/api/src/index.ts) ---

const StoreLive = Layer.mergeAll(
	TaskStoreLive,
	TraceStoreLive,
	ComputeStoreLive,
	VaultStoreLive,
	CodexAuthStoreLive,
).pipe(Layer.provideMerge(DbServiceLive))

const InfraLive = Layer.mergeAll(makeEffectDevToolsLive(), SandboxServiceLive).pipe(
	Layer.provideMerge(StoreLive),
	Layer.provideMerge(EnvServiceLive),
)
const AttachmentLive = makeAttachmentServicesLocal().pipe(Layer.provideMerge(InfraLive))
const VaultLive = CodexVaultServiceLive.pipe(
	Layer.provideMerge(VaultServiceLive),
	Layer.provideMerge(InfraLive),
)

const ServicesLive = Layer.mergeAll(
	MemoryServiceLive,
	AutomationServiceLive,
	TaskSupervisorLive,
	ModelServiceLive,
	AuthLive,
	ConnectorsServiceLive,
	BrowserServiceDisabledLive,
).pipe(Layer.provideMerge(VaultLive), Layer.provideMerge(AttachmentLive))

const SharedLive = PluginRegistryLive.pipe(Layer.provideMerge(ServicesLive))

// --- Test helpers ---

function log(icon: string, msg: string) {
	console.log(`  ${icon} ${msg}`)
}

function header(title: string) {
	console.log(`\n${"=".repeat(60)}`)
	console.log(`  ${title}`)
	console.log("=".repeat(60))
}

function pass(name: string) {
	log("✅", name)
}

function fail(name: string, err?: unknown) {
	log("❌", `${name}: ${err instanceof Error ? err.message : String(err ?? "unknown")}`)
}

// --- Test Flows ---

async function main() {
	console.log("\n🧪 Telegram Flow Local Simulation\n")

	const runtime = ManagedRuntime.make(SharedLive)

	let maybeUserId: string | undefined
	let maybeConversationId: string | undefined
	const results: { name: string; ok: boolean; error?: string }[] = []

	function record(name: string, ok: boolean, error?: string) {
		results.push({ name, ok, error })
		if (ok) pass(name)
		else fail(name, error)
	}

	// --- Test 1: Find or create user ---
	header("Test 1: Find or Create User")
	try {
		maybeUserId = await runtime.runPromise(
			Effect.gen(function* () {
				const { query } = yield* DbService
				const metadata = {
					chatId: SIMULATED_CHAT_ID,
					username: null,
					firstName: SIMULATED_FROM.first_name,
					lastName: SIMULATED_FROM.last_name,
					languageCode: SIMULATED_FROM.language_code,
					isPremium: false,
				}

				const existing = yield* query((db) =>
					db
						.select({ userId: schema.accounts.userId, id: schema.accounts.id })
						.from(schema.accounts)
						.where(
							and(
								eq(schema.accounts.providerId, TELEGRAM_PROVIDER_ID),
								eq(schema.accounts.accountId, String(SIMULATED_FROM.id)),
							),
						)
						.limit(1),
				)

				if (existing[0]) {
					log("ℹ️", `Found existing user: ${existing[0].userId}`)
					return existing[0].userId
				}

				const newUserId = crypto.randomUUID()
				const name = [SIMULATED_FROM.first_name, SIMULATED_FROM.last_name].filter(Boolean).join(" ")

				yield* query((db) =>
					db.transaction(async (tx) => {
						await tx.insert(schema.users).values({
							id: newUserId,
							name,
							timezone: "America/New_York",
						})
						await tx.insert(schema.accounts).values({
							id: crypto.randomUUID(),
							userId: newUserId,
							accountId: String(SIMULATED_FROM.id),
							providerId: TELEGRAM_PROVIDER_ID,
							telegramChatId: String(SIMULATED_CHAT_ID),
							metadata,
						})
					}),
				)

				log("ℹ️", `Created new user: ${newUserId}`)
				return newUserId
			}),
		)

		if (maybeUserId) {
			const uid = maybeUserId
			const verifyUser = await runtime.runPromise(
				Effect.gen(function* () {
					const { query } = yield* DbService
					return yield* query((db) =>
						db
							.select({ id: schema.users.id, name: schema.users.name })
							.from(schema.users)
							.where(eq(schema.users.id, uid))
							.limit(1),
					)
				}),
			)

			if (verifyUser[0]) {
				record("User created/found", true)
				log("ℹ️", `User: ${verifyUser[0].id} (${verifyUser[0].name})`)
			} else {
				record("User created/found", false, "User not found in DB after creation")
			}
		}
	} catch (err) {
		record("User created/found", false, String(err))
	}

	if (!maybeUserId) {
		console.error("\n Cannot proceed without a user. Exiting.\n")
		process.exit(1)
	}
	const userId: string = maybeUserId

	// --- Test 2: Ensure conversation ---
	header("Test 2: Ensure Conversation")
	try {
		maybeConversationId = await runtime.runPromise(
			Effect.gen(function* () {
				const agent = yield* ConversationRuntime
				return yield* agent.ensureConversation("telegram", String(SIMULATED_CHAT_ID))
			}).pipe(Effect.provide(makeConversationRuntimeLive(userId))),
		)

		record("Conversation created/found", true)
		log("ℹ️", `Conversation: ${maybeConversationId}`)
	} catch (err) {
		record("Conversation created/found", false, String(err))
	}

	if (!maybeConversationId) {
		console.error("\n Cannot proceed without a conversation. Exiting.\n")
		process.exit(1)
	}
	const conversationId: string = maybeConversationId

	// --- Test 3: Idempotent conversation (re-run should succeed) ---
	header("Test 3: Idempotent Conversation")
	try {
		const convId2 = await runtime.runPromise(
			Effect.gen(function* () {
				const agent = yield* ConversationRuntime
				return yield* agent.ensureConversation("telegram", String(SIMULATED_CHAT_ID))
			}).pipe(Effect.provide(makeConversationRuntimeLive(userId))),
		)

		if (convId2 === conversationId) {
			record("Idempotent conversation", true)
		} else {
			record("Idempotent conversation", false, `Got different ID: ${convId2}`)
		}
	} catch (err) {
		record("Idempotent conversation", false, String(err))
	}

	// --- Helper: send message and check routing ---
	async function sendAndCheck(
		message: string,
		expectedMode: string | null,
		expectedSpecialists: string[] | null,
	) {
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const agent = yield* ConversationRuntime
				return yield* agent.handleMessage(conversationId, message)
			}).pipe(Effect.provide(makeConversationRuntimeLive(userId))),
		)

		const mode = result.execution.mode
		const specialists = result.execution.tasks.map((t) => t.specialist)

		log("ℹ️", `Mode: ${mode}, Specialists: [${specialists.join(", ") || "none"}]`)
		log("ℹ️", `Response: "${result.userResponse.text.trim().slice(0, 120)}..."`)

		if (expectedMode && mode !== expectedMode) {
			throw new Error(`Expected mode=${expectedMode}, got mode=${mode}`)
		}
		if (expectedSpecialists) {
			for (const s of expectedSpecialists) {
				if (!specialists.includes(s as never)) {
					throw new Error(`Expected specialist "${s}" in [${specialists.join(", ")}]`)
				}
			}
		}

		return result
	}

	// --- Test 4: Simple greeting → direct (no specialist) ---
	header("Test 4: Routing — Direct (greeting)")
	try {
		await sendAndCheck("Hello! How are you?", "direct", null)
		record("Route: direct greeting", true)
	} catch (err) {
		record("Route: direct greeting", false, String(err))
	}

	// --- Test 5: Memory save → memory specialist ---
	header("Test 5: Routing — Memory")
	try {
		const result = await sendAndCheck(
			"Remember this: my favorite programming language is TypeScript",
			null,
			["memory"],
		)
		const memorySaved = (result.sideEffects.memoriesSaved?.length ?? 0) > 0
		log("ℹ️", `Memory saved: ${memorySaved}`)
		record("Route: memory specialist", true)
	} catch (err) {
		record("Route: memory specialist", false, String(err))
	}

	// --- Test 6: Research request → research specialist ---
	header("Test 6: Routing — Research")
	try {
		await sendAndCheck(
			"Investigate the file structure of the /src directory and list what modules exist",
			null,
			["research"],
		)
		record("Route: research specialist", true)
	} catch (err) {
		record("Route: research specialist", false, String(err))
	}

	// --- Test 7: Settings / timezone → settings specialist ---
	header("Test 7: Routing — Settings (timezone)")
	try {
		await sendAndCheck("Set my timezone to America/Los_Angeles", null, ["settings"])
		record("Route: settings specialist", true)
	} catch (err) {
		record("Route: settings specialist", false, String(err))
	}

	// --- Test 8: Integration request → integration specialist ---
	header("Test 8: Routing — Integration")
	try {
		await sendAndCheck("Check my Gmail for new messages", null, ["integration"])
		record("Route: integration specialist", true)
	} catch (err) {
		record("Route: integration specialist", false, String(err))
	}

	// --- Test 9: Builder request → builder specialist ---
	header("Test 9: Routing — Builder")
	try {
		await sendAndCheck("Implement a hello world function in /src/hello.ts", null, ["builder"])
		record("Route: builder specialist", true)
	} catch (err) {
		record("Route: builder specialist", false, String(err))
	}

	// --- Browser / CUA routing tests ---
	// NOTE: This test runtime uses BrowserServiceDisabledLive, so browser
	// is disabled. The router correctly falls back to computer for web tasks.
	// Tests accept either browser or computer to validate the routing logic
	// works regardless of which capability is available.

	// --- Test 10: URL extract → browser (or computer when browser disabled) ---
	header("Test 10: Routing — URL extract")
	try {
		const result = await sendAndCheck(
			"Go to https://example.com and summarize what's on the page",
			null,
			null,
		)
		const specialists = result.execution.tasks.map((t) => t.specialist)
		const hasBrowserOrComputer = specialists.includes("browser") || specialists.includes("computer")
		if (!hasBrowserOrComputer) {
			throw new Error(`Expected browser or computer in [${specialists.join(", ")}]`)
		}
		log(
			"ℹ️",
			`Routed to: ${specialists.includes("browser") ? "browser" : "computer"} (browser disabled=${!specialists.includes("browser")})`,
		)
		record("Route: URL extract → browser|computer", true)
	} catch (err) {
		record("Route: URL extract → browser|computer", false, String(err))
	}

	// --- Test 11: Multi-URL parallel ---
	header("Test 11: Routing — Multi-URL parallel")
	try {
		const result = await sendAndCheck(
			"Compare the homepages of https://example.com and https://example.org side by side",
			"parallel",
			null,
		)
		const webTasks = result.execution.tasks.filter(
			(t) => t.specialist === "browser" || t.specialist === "computer",
		)
		if (webTasks.length < 2) {
			throw new Error(`Expected ≥2 browser|computer tasks for multi-URL, got ${webTasks.length}`)
		}
		log(
			"ℹ️",
			`Parallel web tasks: ${webTasks.length} (${webTasks.map((t) => t.specialist).join(", ")})`,
		)
		record("Route: multi-URL → parallel browser|computer", true)
	} catch (err) {
		record("Route: multi-URL → parallel browser|computer", false, String(err))
	}

	// --- Test 12: Form interaction → browser|computer ---
	header("Test 12: Routing — Form interaction (login)")
	try {
		const result = await sendAndCheck(
			"Log into my account at https://app.example.com/login using my credentials",
			null,
			null,
		)
		const specialists = result.execution.tasks.map((t) => t.specialist)
		const hasBrowserOrComputer = specialists.includes("browser") || specialists.includes("computer")
		if (!hasBrowserOrComputer) {
			throw new Error(`Expected browser or computer in [${specialists.join(", ")}]`)
		}
		record("Route: form interaction → browser|computer", true)
	} catch (err) {
		record("Route: form interaction → browser|computer", false, String(err))
	}

	// --- Test 13: CUA — desktop app interaction ---
	header("Test 13: Routing — Computer (desktop app)")
	try {
		const result = await sendAndCheck(
			"Open the Terminal application and run htop to check CPU usage",
			null,
			["computer"],
		)
		log("ℹ️", `Mode: ${result.execution.mode}`)
		record("Route: computer (desktop app)", true)
	} catch (err) {
		record("Route: computer (desktop app)", false, String(err))
	}

	// --- Test 14: CUA — cross-app workflow ---
	header("Test 14: Routing — Computer (cross-app)")
	try {
		const result = await sendAndCheck(
			"Download the PDF from https://example.com/report.pdf and open it in Preview",
			null,
			["computer"],
		)
		log("ℹ️", `Mode: ${result.execution.mode}`)
		record("Route: computer (cross-app)", true)
	} catch (err) {
		record("Route: computer (cross-app)", false, String(err))
	}

	// --- Test 15: CUA — system monitoring ---
	header("Test 15: Routing — Computer (system monitoring)")
	try {
		const result = await sendAndCheck(
			"Check how much disk space is available on the machine",
			null,
			["computer"],
		)
		log("ℹ️", `Mode: ${result.execution.mode}`)
		record("Route: computer (system monitoring)", true)
	} catch (err) {
		record("Route: computer (system monitoring)", false, String(err))
	}

	// --- Test 16: CUA — multi-site workflow (always computer, not browser) ---
	header("Test 16: Routing — Computer (multi-site workflow)")
	try {
		const result = await sendAndCheck(
			"Download a report from https://reports.example.com then upload it to https://drive.example.com",
			null,
			["computer"],
		)
		log("ℹ️", `Mode: ${result.execution.mode}`)
		record("Route: computer (multi-site workflow)", true)
	} catch (err) {
		record("Route: computer (multi-site workflow)", false, String(err))
	}

	// --- Test 17: Research + builder → sequential with both ---
	header("Test 17: Routing — Sequential (research → builder)")
	try {
		const result = await sendAndCheck(
			"Research the current codebase patterns, then implement a new utility function",
			"sequential",
			["research", "builder"],
		)
		const researchIdx = result.execution.tasks.findIndex((t) => t.specialist === "research")
		const builderIdx = result.execution.tasks.findIndex((t) => t.specialist === "builder")
		if (researchIdx >= builderIdx) {
			throw new Error(
				`research (idx=${researchIdx}) should come before builder (idx=${builderIdx})`,
			)
		}
		record("Route: sequential research→builder", true)
	} catch (err) {
		record("Route: sequential research→builder", false, String(err))
	}

	// --- Test 18: Verify DB state — runs, messages, tasks ---
	header("Test 18: Verify DB State")
	try {
		const dbState = await runtime.runPromise(
			Effect.gen(function* () {
				const { query } = yield* DbService
				const msgs = yield* query((db) =>
					db
						.select({ id: schema.messages.id })
						.from(schema.messages)
						.where(eq(schema.messages.conversationId, conversationId)),
				)
				const threads = yield* query((db) =>
					db
						.select({ id: schema.conversationThreads.id })
						.from(schema.conversationThreads)
						.where(eq(schema.conversationThreads.conversationId, conversationId)),
				)
				const dbRuns = yield* query((db) =>
					db
						.select({
							id: schema.runs.id,
							mode: schema.runs.mode,
							specialist: schema.runs.specialist,
							status: schema.runs.status,
						})
						.from(schema.runs)
						.where(eq(schema.runs.conversationId, conversationId)),
				)
				const dbTasks = yield* query((db) =>
					db
						.select({
							id: schema.tasks.id,
							specialist: schema.tasks.specialist,
							status: schema.tasks.status,
							runnerKind: schema.tasks.runnerKind,
						})
						.from(schema.tasks)
						.where(eq(schema.tasks.conversationId, conversationId)),
				)
				return {
					messages: msgs.length,
					threads: threads.length,
					runs: dbRuns,
					tasks: dbTasks,
				}
			}),
		)

		log("ℹ️", `Messages: ${dbState.messages}, Threads: ${dbState.threads}`)
		log("ℹ️", `Runs: ${dbState.runs.length}`)
		for (const run of dbState.runs) {
			log(
				"  ",
				`run ${run.id.slice(0, 8)}… mode=${run.mode} specialist=${run.specialist ?? "-"} status=${run.status}`,
			)
		}
		log("ℹ️", `Tasks: ${dbState.tasks.length}`)
		for (const task of dbState.tasks) {
			log(
				"  ",
				`task ${task.id.slice(0, 8)}… specialist=${task.specialist ?? "-"} runner=${task.runnerKind ?? "-"} status=${task.status}`,
			)
		}

		// Verify we got runs and messages from the routing tests
		const specialistsInRuns = new Set(dbState.runs.map((r) => r.specialist).filter(Boolean))
		log("ℹ️", `Specialists seen in runs: [${[...specialistsInRuns].join(", ")}]`)

		record("DB state populated", dbState.messages > 0 && dbState.runs.length > 0)
	} catch (err) {
		record("DB state populated", false, String(err))
	}

	// --- Summary ---
	header("Test Summary")
	const passed = results.filter((r) => r.ok).length
	const failed = results.filter((r) => !r.ok).length
	const total = results.length

	for (const r of results) {
		log(r.ok ? "✅" : "❌", r.name + (r.error ? ` — ${r.error}` : ""))
	}

	console.log(`\n  ${passed}/${total} passed, ${failed} failed\n`)

	// --- Cleanup test data ---
	header("Cleanup")
	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				const { query } = yield* DbService

				if (conversationId) {
					// taskEvents cascade-deletes via FK on tasks.id
					yield* query((db) =>
						db.delete(schema.tasks).where(eq(schema.tasks.conversationId, conversationId)),
					)
					// runEvents cascade-deletes via FK on runs.id
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
				}
				if (userId) {
					yield* query((db) => db.delete(schema.memories).where(eq(schema.memories.userId, userId)))
					yield* query((db) => db.delete(schema.accounts).where(eq(schema.accounts.userId, userId)))
					yield* query((db) => db.delete(schema.users).where(eq(schema.users.id, userId)))
				}
			}),
		)
		log("🧹", "Test data cleaned up")
	} catch (err) {
		log("⚠️", `Cleanup failed: ${err instanceof Error ? err.message : String(err)}`)
	}

	await runtime.dispose()
	process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
	console.error("Fatal:", err)
	process.exit(1)
})
