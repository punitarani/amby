import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import type { ResolveThreadResult } from "../router"
import { prepareConversationContext } from "./builder"

type QueryFn = <T>(
	fn: (db: import("@amby/db").Database) => Promise<T>,
) => Effect.Effect<T, import("@amby/db").DbError>

/**
 * Stub QueryFn that routes based on the query pattern.
 * Since we can't inspect the actual SQL, we dispatch based on
 * sequential call order.
 */
function makeStubQuery(opts?: {
	timezone?: string
	threadLabel?: string
	threadSynopsis?: string
	messages?: Array<{ id: string; role: string; content: string }>
	otherThreads?: Array<{ label: string | null; synopsis: string | null }>
}): QueryFn {
	let callIndex = 0
	return (<T>(_fn: (db: unknown) => Promise<T>) => {
		callIndex++
		// Call 1: user timezone lookup
		if (callIndex === 1) {
			return Effect.succeed([{ timezone: opts?.timezone ?? "UTC" }] as unknown as T)
		}
		// Calls 2-5 are concurrent: threadRows, history, otherThreads, artifacts
		if (callIndex === 2) {
			// threadRows
			return Effect.succeed([
				{
					label: opts?.threadLabel ?? null,
					synopsis: opts?.threadSynopsis ?? null,
				},
			] as unknown as T)
		}
		// For the rest, return empty arrays (loadThreadTail, loadOtherThreadSummaries, loadThreadArtifacts)
		// These do multiple inner queries but since we're stubbing at the query level,
		// we return reasonable defaults
		return Effect.succeed([] as unknown as T)
	}) as QueryFn
}

function makeThreadCtx(overrides?: Partial<ResolveThreadResult>): ResolveThreadResult {
	return {
		threadId: overrides?.threadId ?? "thread-1",
		defaultThreadId: overrides?.defaultThreadId ?? "thread-1",
		decision: overrides?.decision ?? {
			action: "continue",
			threadId: "thread-1",
			source: "derived",
		},
		threadMessageCount: overrides?.threadMessageCount ?? 5,
		previousLastThreadId: overrides?.previousLastThreadId ?? "thread-1",
		threadWasDormant: overrides?.threadWasDormant ?? false,
	}
}

describe("prepareConversationContext", () => {
	it("returns a valid PreparedConversationContext shape", async () => {
		const query = makeStubQuery()
		const result = await Effect.runPromise(
			prepareConversationContext({
				query,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx(),
			}),
		)

		expect(result).toHaveProperty("history")
		expect(result).toHaveProperty("systemPrompt")
		expect(result).toHaveProperty("sharedPromptContext")
		expect(result).toHaveProperty("userTimezone")
		expect(result).toHaveProperty("formattedNow")
		expect(Array.isArray(result.history)).toBe(true)
		expect(typeof result.systemPrompt).toBe("string")
		expect(typeof result.sharedPromptContext).toBe("string")
	})

	it("resolves user timezone from query", async () => {
		const query = makeStubQuery({ timezone: "America/New_York" })
		const result = await Effect.runPromise(
			prepareConversationContext({
				query,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx(),
			}),
		)

		expect(result.userTimezone).toBe("America/New_York")
		// Intl.DateTimeFormat produces timezone abbreviations like EDT/EST
		expect(result.formattedNow).toMatch(/E[DS]T/)
	})

	it("defaults to UTC when user has no timezone", async () => {
		// Return empty array for user row so no timezone is found
		let callIdx = 0
		const emptyQuery: QueryFn = (<T>(_fn: unknown) => {
			callIdx++
			if (callIdx === 1) return Effect.succeed([] as unknown as T)
			return Effect.succeed([] as unknown as T)
		}) as QueryFn

		const result = await Effect.runPromise(
			prepareConversationContext({
				query: emptyQuery,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx(),
			}),
		)

		expect(result.userTimezone).toBe("UTC")
	})

	it("includes memory context in systemPrompt when provided", async () => {
		const query = makeStubQuery()
		const result = await Effect.runPromise(
			prepareConversationContext({
				query,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx(),
				memoryContext: "User prefers TypeScript. Working on billing.",
			}),
		)

		expect(result.systemPrompt).toContain("User Memory Context")
		expect(result.systemPrompt).toContain("User prefers TypeScript")
		expect(result.sharedPromptContext).toContain("User Memory Context")
	})

	it("excludes memory section when memoryContext is not provided", async () => {
		const query = makeStubQuery()
		const result = await Effect.runPromise(
			prepareConversationContext({
				query,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx(),
			}),
		)

		expect(result.systemPrompt).not.toContain("User Memory Context")
	})

	it("includes dormant thread synopsis when thread was dormant", async () => {
		const query = makeStubQuery({ threadSynopsis: "Previously discussed auth refactor" })
		const result = await Effect.runPromise(
			prepareConversationContext({
				query,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx({ threadWasDormant: true }),
			}),
		)

		expect(result.systemPrompt).toContain("Resumed thread synopsis")
		expect(result.systemPrompt).toContain("Previously discussed auth refactor")
	})

	it("excludes dormant synopsis when thread is not dormant", async () => {
		const query = makeStubQuery({ threadSynopsis: "Some synopsis" })
		const result = await Effect.runPromise(
			prepareConversationContext({
				query,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx({ threadWasDormant: false }),
			}),
		)

		expect(result.systemPrompt).not.toContain("Resumed thread synopsis")
	})

	it("includes current date/time in sharedPromptContext", async () => {
		const query = makeStubQuery({ timezone: "UTC" })
		const result = await Effect.runPromise(
			prepareConversationContext({
				query,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx(),
			}),
		)

		expect(result.sharedPromptContext).toContain("Current Date/Time")
		expect(result.sharedPromptContext).toContain("UTC")
	})

	it("systemPrompt includes conversation prompt preamble", async () => {
		const query = makeStubQuery()
		const result = await Effect.runPromise(
			prepareConversationContext({
				query,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx(),
			}),
		)

		expect(result.systemPrompt).toContain("Amby")
	})

	it("includes Telegram-specific formatting rules when the response channel is Telegram", async () => {
		const query = makeStubQuery()
		const result = await Effect.runPromise(
			prepareConversationContext({
				query,
				userId: "user-1",
				conversationId: "conv-1",
				threadCtx: makeThreadCtx(),
				responseChannel: "telegram",
			}),
		)

		expect(result.systemPrompt).toContain("The user is reading this in Telegram.")
		expect(result.systemPrompt).toContain("valid Telegram HTML")
		expect(result.systemPrompt).toContain("bullet characters like •")
		expect(result.systemPrompt).toContain("Do not use Markdown emphasis markers")
	})
})
