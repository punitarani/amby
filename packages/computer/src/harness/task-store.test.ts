import { describe, expect, it } from "bun:test"
import {
	deriveRuntimeForRunner,
	mapExecutionResultStatus,
	readSandboxRuntimeData,
	taskEventKindForTerminalStatus,
} from "./task-store"

describe("deriveRuntimeForRunner", () => {
	it("maps browser service tasks to the browser runtime", () => {
		expect(deriveRuntimeForRunner({ runnerKind: "browser_service" })).toEqual({
			runtime: "browser",
			provider: "stagehand",
			requiresBrowser: true,
		})
	})

	it("maps background handoff tasks to the sandbox runtime", () => {
		expect(
			deriveRuntimeForRunner({ runnerKind: "background_handoff", requiresBrowser: true }),
		).toEqual({
			runtime: "sandbox",
			provider: "codex",
			requiresBrowser: true,
		})
	})

	it("maps toolloop tasks to the in-process runtime", () => {
		expect(deriveRuntimeForRunner({ runnerKind: "toolloop" })).toEqual({
			runtime: "in_process",
			provider: "internal",
			requiresBrowser: false,
		})
	})
})

describe("mapExecutionResultStatus", () => {
	it("preserves partial and escalated terminal states", () => {
		expect(mapExecutionResultStatus("completed")).toBe("succeeded")
		expect(mapExecutionResultStatus("partial")).toBe("partial")
		expect(mapExecutionResultStatus("escalate")).toBe("escalated")
		expect(mapExecutionResultStatus("failed")).toBe("failed")
	})
})

describe("taskEventKindForTerminalStatus", () => {
	it("emits dedicated event kinds for partial and escalated results", () => {
		expect(taskEventKindForTerminalStatus("partial")).toBe("task.partial")
		expect(taskEventKindForTerminalStatus("escalated")).toBe("task.escalated")
		expect(taskEventKindForTerminalStatus("failed")).toBe("task.failed")
	})
})

describe("readSandboxRuntimeData", () => {
	it("returns sandbox runtime metadata from runtimeData", () => {
		expect(
			readSandboxRuntimeData({
				runtime: "sandbox",
				runtimeData: {
					authMode: "api_key",
					sandboxId: "sbx-1",
					sessionId: "session-1",
					commandId: "cmd-1",
					artifactRoot: "/tmp/task",
				},
			}),
		).toEqual({
			authMode: "api_key",
			sandboxId: "sbx-1",
			sessionId: "session-1",
			commandId: "cmd-1",
			artifactRoot: "/tmp/task",
		})
	})

	it("ignores runtimeData for non-sandbox tasks", () => {
		expect(
			readSandboxRuntimeData({
				runtime: "browser",
				runtimeData: {
					sessionId: "session-1",
				},
			}),
		).toBeNull()
	})
})
