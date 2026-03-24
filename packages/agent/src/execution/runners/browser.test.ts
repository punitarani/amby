import { describe, expect, it } from "bun:test"
import type { BrowserService, BrowserTaskResult } from "@amby/browser"
import { Effect } from "effect"
import type { ExecutionTask } from "../../types/execution"
import { runBrowserSpecialist } from "./browser"

function makeTask(): ExecutionTask {
	return {
		id: "task-1",
		rootTaskId: "task-1",
		depth: 1,
		specialist: "browser",
		runnerKind: "browser_service",
		mode: "sequential",
		input: {
			kind: "browser",
			task: {
				mode: "extract",
				instruction: "Collect the page data.",
				sideEffectLevel: "read",
			},
		},
		dependencies: [],
		inputBindings: {},
		resourceLocks: [],
		mutates: false,
		writesExternal: false,
		requiresConfirmation: false,
		requiresValidation: false,
	}
}

function makeBrowserService(result: BrowserTaskResult) {
	return {
		enabled: true,
		runTask: () => Effect.succeed(result),
	} as unknown as import("effect").Context.Tag.Service<typeof BrowserService>
}

const trace = {
	traceId: "trace-1",
	append: () => Effect.succeed<void>(undefined),
	appendMany: () => Effect.succeed<void>(undefined),
	setMode: () => Effect.succeed<void>(undefined),
	updateMetadata: () => Effect.succeed<void>(undefined),
	linkMessage: () => Effect.succeed<void>(undefined),
	complete: () => Effect.succeed<void>(undefined),
}

describe("runBrowserSpecialist", () => {
	it("keeps extract output plain while persisting the final page in runtimeData", async () => {
		const task = makeTask()
		const run = await runBrowserSpecialist({
			task,
			browser: makeBrowserService({
				status: "completed",
				summary: "Extracted browser data.",
				page: { url: "https://example.com", title: "Example" },
				output: { headlines: ["A", "B"] },
				artifacts: [{ kind: "page", uri: "https://example.com" }],
				runtimeData: { model: "kimi" },
			}),
			trace,
		})

		expect(run.result.data).toEqual({ headlines: ["A", "B"] })
		expect(run.result.runtimeData).toEqual({
			model: "kimi",
			finalPage: { url: "https://example.com", title: "Example" },
		})
	})

	it("persists page and actions for browser workflows", async () => {
		const task = makeTask()
		task.input = {
			kind: "browser",
			task: {
				mode: "agent",
				instruction: "Complete the workflow.",
				sideEffectLevel: "soft-write",
			},
		}

		const run = await runBrowserSpecialist({
			task,
			browser: makeBrowserService({
				status: "completed",
				summary: "Completed browser workflow.",
				page: { url: "https://example.com/done", title: "Done" },
				output: { confirmation: "ok" },
				actions: [{ action: "click", target: "Submit" }],
				runtimeData: { model: "kimi", mode: "agent" },
			}),
			trace,
		})

		expect(run.result.data).toEqual({
			page: { url: "https://example.com/done", title: "Done" },
			output: { confirmation: "ok" },
			actions: [{ action: "click", target: "Submit" }],
		})
		expect(run.result.runtimeData).toEqual({
			model: "kimi",
			mode: "agent",
			finalPage: { url: "https://example.com/done", title: "Done" },
			actions: [{ action: "click", target: "Submit" }],
		})
	})
})
