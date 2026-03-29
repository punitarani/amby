import { describe, expect, it, mock } from "bun:test"
import type { BufferedMessage } from "@amby/channels"
import {
	beginProcessingState,
	createInitialSessionState,
	handleProcessingFollowUpState,
	RERUN_DEBOUNCE_MS,
	type SessionState,
	WORKFLOW_CREATE_RETRY_MS,
} from "./conversation-session-state"

await mock.module("cloudflare:workers", () => ({
	DurableObject: class DurableObject<TEnv = unknown> {
		protected readonly ctx: unknown
		protected readonly env: TEnv

		constructor(ctx: unknown, env: TEnv) {
			this.ctx = ctx
			this.env = env
		}
	},
}))

const { ConversationSession } = await import("./conversation-session")

function makeBufferedMessage(text: string, messageId: number): BufferedMessage {
	return {
		sourceMessageId: messageId,
		date: 1_700_000_000 + messageId,
		textSummary: text,
		parts: [{ type: "text", text }],
		mediaGroupId: null,
		from: null,
		rawSource: {
			platform: "telegram",
			messageIds: [messageId],
		},
	}
}

class FakeStorage {
	private readonly values = new Map<string, unknown>()
	alarmAt: number | null = null

	constructor(initialState?: unknown) {
		if (initialState !== undefined) {
			this.values.set("state", initialState)
		}
	}

	async get<T>(key: string): Promise<T | undefined> {
		return this.values.get(key) as T | undefined
	}

	async put(key: string, value: unknown): Promise<void> {
		this.values.set(key, structuredClone(value))
	}

	async setAlarm(time: number): Promise<void> {
		this.alarmAt = time
	}

	readState<T>(): T | undefined {
		return this.values.get("state") as T | undefined
	}
}

function makeSession(params?: {
	initialState?: unknown
	workflow?: {
		get?: (id: string) => Promise<{ status: () => Promise<{ status: string }> }>
		create?: (options: { id?: string; params?: unknown }) => Promise<{ id: string }>
	}
}) {
	const storage = new FakeStorage(params?.initialState)
	const ctx = {
		storage,
		blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => await callback(),
	} as const
	const env = {
		AGENT_WORKFLOW: params?.workflow,
	} as const

	return {
		storage,
		session: new ConversationSession(ctx as never, env as never),
	}
}

async function withMockedNow<T>(now: number, callback: () => Promise<T>) {
	const originalNow = Date.now
	Date.now = () => now
	try {
		return await callback()
	} finally {
		Date.now = originalNow
	}
}

async function withSilencedConsoleError<T>(callback: () => Promise<T>) {
	const originalError = console.error
	console.error = () => {}
	try {
		return await callback()
	} finally {
		console.error = originalError
	}
}

function makeProcessingState(): SessionState {
	const state = createInitialSessionState()
	state.chatId = 456
	state.buffer = [makeBufferedMessage("draft the reply", 1)]
	beginProcessingState({
		state,
		messages: [...state.buffer],
		executionToken: "token-1",
		now: 1_000,
	})
	return state
}

describe("ConversationSession durable-object behavior", () => {
	it("schedules the Cloudflare alarm when completion needs a rerun", async () => {
		const state = makeProcessingState()
		const correction = makeBufferedMessage("actually mention March", 2)
		state.buffer.push(correction)
		handleProcessingFollowUpState(state, correction, 1_050)

		const { session, storage } = makeSession({ initialState: state })

		const result = await withMockedNow(1_100, async () =>
			session.completeExecution({
				executionToken: "token-1",
				outcome: "completed",
			}),
		)

		expect(result).toEqual({ accepted: true, shouldRerun: true })
		expect(storage.alarmAt).toBe(1_100 + RERUN_DEBOUNCE_MS)
		expect(storage.readState<SessionState>()?.status).toBe("debouncing")
	})

	it("restores in-flight messages when the workflow instance is missing", async () => {
		const state = makeProcessingState()
		state.activeWorkflowId = "workflow-1"
		state.buffer.push(makeBufferedMessage("follow up", 2))

		const { session, storage } = makeSession({
			initialState: state,
			workflow: {
				get: async () => {
					throw new Error("missing workflow")
				},
			},
		})

		await withSilencedConsoleError(async () => withMockedNow(2_000, async () => session.alarm()))

		const persisted = storage.readState<SessionState>()
		expect(persisted?.status).toBe("debouncing")
		expect(persisted?.buffer).toEqual([
			makeBufferedMessage("draft the reply", 1),
			makeBufferedMessage("follow up", 2),
		])
		expect(persisted?.activeExecutionToken).toBeNull()
		expect(storage.alarmAt).toBe(2_000 + WORKFLOW_CREATE_RETRY_MS)
	})

	it("keeps the session untouched when the workflow is still active", async () => {
		const state = makeProcessingState()
		state.activeWorkflowId = "workflow-1"

		const { session, storage } = makeSession({
			initialState: state,
			workflow: {
				get: async () => ({
					status: async () => ({ status: "running" }),
				}),
			},
		})

		await withMockedNow(3_000, async () => session.alarm())

		expect(storage.alarmAt).toBeNull()
		expect(storage.readState<SessionState>()).toEqual(state)
	})

	it("requeues buffered messages when workflow creation fails during startup", async () => {
		const state = createInitialSessionState()
		state.chatId = 456
		state.status = "debouncing"
		state.buffer = [makeBufferedMessage("draft the reply", 1)]

		const { session, storage } = makeSession({
			initialState: state,
			workflow: {
				create: async () => {
					throw new Error("workflow create failed")
				},
			},
		})

		await withSilencedConsoleError(async () => withMockedNow(4_000, async () => session.alarm()))

		const persisted = storage.readState<SessionState>()
		expect(persisted?.status).toBe("debouncing")
		expect(persisted?.buffer).toEqual([makeBufferedMessage("draft the reply", 1)])
		expect(persisted?.inFlightMessages).toEqual([])
		expect(persisted?.activeExecutionToken).toBeNull()
		expect(storage.alarmAt).toBe(4_000 + WORKFLOW_CREATE_RETRY_MS)
	})
})
