/**
 * Local simulation of the Telegram → Agent flow.
 *
 * Bypasses wrangler, Cloudflare Durable Objects, Workflows, and Queues.
 * Runs against the local Postgres DB directly using the same runtime
 * layers as apps/api/src/index.ts (local bun dev mode).
 *
 * Usage: doppler run -- bun run scripts/test-telegram-flow.ts
 */

import { AgentService, ModelServiceLive, makeAgentServiceLive } from "@amby/agent"
import { AuthServiceLive } from "@amby/auth"
import { BrowserServiceDisabledLive } from "@amby/browser/local"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import { and, DbService, DbServiceLive, eq, schema } from "@amby/db"
import { EnvServiceLive, makeEffectDevToolsLive } from "@amby/env/local"
import { MemoryServiceLive } from "@amby/memory"
import { ConnectorsServiceLive } from "@amby/plugins/integrations"
import { Effect, Layer, ManagedRuntime } from "effect"
import { PluginRegistryLive } from "../shared/plugin-registry"

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

const InfraLive = Layer.mergeAll(makeEffectDevToolsLive(), SandboxServiceLive).pipe(
	Layer.provideMerge(DbServiceLive),
	Layer.provideMerge(EnvServiceLive),
)

const ServicesLive = Layer.mergeAll(
	MemoryServiceLive,
	TaskSupervisorLive,
	ModelServiceLive,
	AuthServiceLive,
	ConnectorsServiceLive,
	BrowserServiceDisabledLive,
).pipe(Layer.provideMerge(InfraLive))

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
								eq(schema.accounts.providerId, "telegram"),
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
							providerId: "telegram",
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
				const agent = yield* AgentService
				return yield* agent.ensureConversation("telegram", String(SIMULATED_CHAT_ID))
			}).pipe(Effect.provide(makeAgentServiceLive(userId))),
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
				const agent = yield* AgentService
				return yield* agent.ensureConversation("telegram", String(SIMULATED_CHAT_ID))
			}).pipe(Effect.provide(makeAgentServiceLive(userId))),
		)

		if (convId2 === conversationId) {
			record("Idempotent conversation", true)
		} else {
			record("Idempotent conversation", false, `Got different ID: ${convId2}`)
		}
	} catch (err) {
		record("Idempotent conversation", false, String(err))
	}

	// --- Test 4: Simple message (direct answer, no specialist) ---
	header("Test 4: Simple Message (Direct Answer)")
	try {
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const agent = yield* AgentService
				return yield* agent.handleMessage(conversationId, "Hello! How are you?")
			}).pipe(Effect.provide(makeAgentServiceLive(userId))),
		)

		if (result.userResponse.text.trim().length > 0) {
			record("Simple message", true)
			log("ℹ️", `Response: "${result.userResponse.text.trim().slice(0, 100)}..."`)
			log("ℹ️", `Status: ${result.status}, Mode: ${result.execution.mode}`)
		} else {
			record("Simple message", false, "Empty response")
		}
	} catch (err) {
		record("Simple message", false, String(err))
	}

	// --- Test 5: Memory save ---
	header("Test 5: Memory Save")
	try {
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const agent = yield* AgentService
				return yield* agent.handleMessage(
					conversationId,
					"Remember this: my favorite programming language is TypeScript",
				)
			}).pipe(Effect.provide(makeAgentServiceLive(userId))),
		)

		record("Memory save", true)
		log("ℹ️", `Response: "${result.userResponse.text.trim().slice(0, 100)}..."`)
		log("ℹ️", `Status: ${result.status}, Mode: ${result.execution.mode}`)
	} catch (err) {
		record("Memory save", false, String(err))
	}

	// --- Test 6: Research/read request ---
	header("Test 6: Research Request")
	try {
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const agent = yield* AgentService
				return yield* agent.handleMessage(
					conversationId,
					"Investigate what day of the week March 25, 2026 falls on",
				)
			}).pipe(Effect.provide(makeAgentServiceLive(userId))),
		)

		record("Research request", true)
		log("ℹ️", `Response: "${result.userResponse.text.trim().slice(0, 100)}..."`)
		log("ℹ️", `Status: ${result.status}, Mode: ${result.execution.mode}`)
	} catch (err) {
		record("Research request", false, String(err))
	}

	// --- Test 7: Settings / timezone ---
	header("Test 7: Timezone Setting")
	try {
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const agent = yield* AgentService
				return yield* agent.handleMessage(conversationId, "Set my timezone to America/Los_Angeles")
			}).pipe(Effect.provide(makeAgentServiceLive(userId))),
		)

		record("Timezone setting", true)
		log("ℹ️", `Response: "${result.userResponse.text.trim().slice(0, 100)}..."`)
	} catch (err) {
		record("Timezone setting", false, String(err))
	}

	// --- Test 8: Verify DB state ---
	header("Test 8: Verify DB State")
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
				const traces = yield* query((db) =>
					db
						.select({ id: schema.traces.id })
						.from(schema.traces)
						.where(eq(schema.traces.conversationId, conversationId)),
				)
				return { messages: msgs.length, threads: threads.length, traces: traces.length }
			}),
		)

		log(
			"ℹ️",
			`Messages: ${dbState.messages}, Threads: ${dbState.threads}, Traces: ${dbState.traces}`,
		)
		record("DB state populated", dbState.messages > 0 || dbState.threads > 0)
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
					// traceEvents cascade-deletes via FK on traces.id
					yield* query((db) =>
						db.delete(schema.traces).where(eq(schema.traces.conversationId, conversationId)),
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
