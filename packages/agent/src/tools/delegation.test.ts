import { describe, expect, it } from "bun:test"
import { z } from "zod"
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
		expect(tools.delegate_task.description).toContain("needsBrowser=true")
	})
})
