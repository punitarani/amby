import { describe, expect, it } from "bun:test"
import type { ExecutionTaskResult } from "../types/execution"
import { buildExecutionSummary } from "./reducer"

function makeResult(
	partial: Partial<ExecutionTaskResult> & Pick<ExecutionTaskResult, "taskId" | "specialist">,
): ExecutionTaskResult {
	return {
		taskId: partial.taskId,
		rootTaskId: partial.rootTaskId ?? partial.taskId,
		depth: partial.depth ?? 1,
		specialist: partial.specialist,
		status: partial.status ?? "completed",
		summary: partial.summary ?? `${partial.specialist} done`,
		data: partial.data,
		artifacts: partial.artifacts,
		issues: partial.issues,
		traceRef: partial.traceRef ?? { traceId: "trace-1" },
		backgroundRef: partial.backgroundRef,
	}
}

describe("buildExecutionSummary", () => {
	it("returns completed with no tasks for direct mode", () => {
		const summary = buildExecutionSummary({ mode: "direct", taskResults: [] })
		expect(summary.status).toBe("completed")
		expect(summary.summary).toBe("Answered directly.")
		expect(summary.taskResults).toHaveLength(0)
	})

	it("returns completed when all tasks succeed", () => {
		const summary = buildExecutionSummary({
			mode: "sequential",
			taskResults: [
				makeResult({ taskId: "a", specialist: "research", summary: "Found info" }),
				makeResult({ taskId: "b", specialist: "builder", summary: "Built feature" }),
			],
		})
		expect(summary.status).toBe("completed")
		expect(summary.summary).toContain("research: Found info")
		expect(summary.summary).toContain("builder: Built feature")
	})

	it("returns failed when any task fails", () => {
		const summary = buildExecutionSummary({
			mode: "sequential",
			taskResults: [
				makeResult({ taskId: "a", specialist: "research" }),
				makeResult({ taskId: "b", specialist: "builder", status: "failed" }),
			],
		})
		expect(summary.status).toBe("failed")
	})

	it("returns partial when tasks have partial or escalate status", () => {
		const summary = buildExecutionSummary({
			mode: "parallel",
			taskResults: [
				makeResult({ taskId: "a", specialist: "research", status: "partial" }),
				makeResult({ taskId: "b", specialist: "browser" }),
			],
		})
		expect(summary.status).toBe("partial")
	})

	it("failed takes precedence over partial", () => {
		const summary = buildExecutionSummary({
			mode: "parallel",
			taskResults: [
				makeResult({ taskId: "a", specialist: "research", status: "partial" }),
				makeResult({ taskId: "b", specialist: "builder", status: "failed" }),
			],
		})
		expect(summary.status).toBe("failed")
	})

	it("includes validator result in status computation", () => {
		const summary = buildExecutionSummary({
			mode: "sequential",
			taskResults: [makeResult({ taskId: "a", specialist: "builder" })],
			validatorResult: makeResult({ taskId: "v", specialist: "validator", status: "failed" }),
		})
		expect(summary.status).toBe("failed")
		expect(summary.taskResults).toHaveLength(2)
	})

	it("collects background task references", () => {
		const summary = buildExecutionSummary({
			mode: "background",
			taskResults: [
				makeResult({
					taskId: "a",
					specialist: "builder",
					backgroundRef: { taskId: "bg-1", traceId: "trace-bg" },
				}),
			],
		})
		expect(summary.backgroundTasks).toHaveLength(1)
		expect(summary.backgroundTasks[0]?.taskId).toBe("bg-1")
		expect(summary.backgroundTasks[0]?.status).toBe("running")
	})

	it("collects memory side effects", () => {
		const summary = buildExecutionSummary({
			mode: "sequential",
			taskResults: [
				makeResult({
					taskId: "a",
					specialist: "memory",
					data: { memoryIds: ["mem-1", "mem-2"] },
				}),
			],
		})
		expect(summary.sideEffects.memoriesSaved).toEqual(["mem-1", "mem-2"])
	})

	it("collects scheduled job side effects", () => {
		const summary = buildExecutionSummary({
			mode: "sequential",
			taskResults: [
				makeResult({
					taskId: "a",
					specialist: "settings",
					data: { scheduledJobIds: ["job-1"] },
				}),
			],
		})
		expect(summary.sideEffects.scheduledJobs).toEqual(["job-1"])
	})

	it("collects integration external write summaries", () => {
		const summary = buildExecutionSummary({
			mode: "sequential",
			taskResults: [
				makeResult({
					taskId: "a",
					specialist: "integration",
					summary: "Sent email to user@example.com",
				}),
			],
		})
		expect(summary.sideEffects.externalWrites).toEqual(["Sent email to user@example.com"])
	})
})
