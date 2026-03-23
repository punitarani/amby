import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import type { z } from "zod"
import { createTaskDelegationTools } from "./delegation"

const mockSupervisor = {
	startTask: () => {
		throw new Error("unused")
	},
	getTask: () => {
		throw new Error("unused")
	},
	probeTask: () => {
		throw new Error("unused")
	},
	getTaskArtifacts: () => {
		throw new Error("unused")
	},
} as never

const mockBrowserTarget = {
	enabled: false,
	runTask: (() => {
		throw new Error("unused")
	}) as never,
}

const mockComputerTarget = {
	enabled: false,
	runTask: (async () => {
		throw new Error("unused")
	}) as never,
}

describe("createTaskDelegationTools", () => {
	it("only accepts enabled targets in the tool schema", () => {
		const tools = createTaskDelegationTools(
			mockSupervisor,
			mockBrowserTarget,
			mockComputerTarget,
			true,
			"user-1",
		)
		const schema = tools.delegate_task.inputSchema as z.ZodTypeAny

		expect(schema.safeParse({ task: "browse", target: "sandbox" }).success).toBe(true)
		expect(schema.safeParse({ task: "browse", target: "browser" }).success).toBe(false)
		expect(schema.safeParse({ task: "browse", target: "computer" }).success).toBe(false)
	})

	it("keeps sandbox browser fallback available when browser delegation is disabled", () => {
		const tools = createTaskDelegationTools(
			mockSupervisor,
			mockBrowserTarget,
			mockComputerTarget,
			true,
			"user-1",
		)
		const schema = tools.delegate_task.inputSchema as z.ZodTypeAny

		const parsed = schema.safeParse({
			task: "open the docs site",
			target: "sandbox",
			needsBrowser: true,
		})

		expect(parsed.success).toBe(true)
		expect(tools.delegate_task.description).toContain("needsBrowser")
	})

	it("routes sandbox+needsBrowser to headless browser when browser delegation is enabled", async () => {
		let startTaskCalls = 0
		let browserCalls = 0
		const supervisor = {
			startTask: () => {
				startTaskCalls += 1
				return Promise.resolve({ taskId: "t1" })
			},
			getTask: () => {
				throw new Error("unused")
			},
			probeTask: () => {
				throw new Error("unused")
			},
			getTaskArtifacts: () => {
				throw new Error("unused")
			},
		} as never

		const browserTarget = {
			enabled: true,
			runTask: () => {
				browserCalls += 1
				return Effect.succeed({
					success: true,
					summary: "ok",
					finalUrl: "https://example.com",
					title: "Example",
				})
			},
		}

		const tools = createTaskDelegationTools(
			supervisor,
			browserTarget,
			mockComputerTarget,
			true,
			"user-1",
		)

		const execute = tools.delegate_task.execute
		if (execute === undefined) {
			throw new Error("expected delegate_task.execute")
		}

		const result = await execute(
			{
				task: "read the page",
				target: "sandbox",
				needsBrowser: true,
			},
			{
				abortSignal: new AbortController().signal,
				toolCallId: "call-1",
				messages: [],
			},
		)

		expect(startTaskCalls).toBe(0)
		expect(browserCalls).toBe(1)
		expect(result).toMatchObject({
			target: "browser",
			success: true,
			summary: "ok",
		})
	})
})
