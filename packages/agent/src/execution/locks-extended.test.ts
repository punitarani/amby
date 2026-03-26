import { describe, expect, it } from "bun:test"
import { makeResult, makeTask } from "../test-helpers/factories"
import { buildReadyBatch, locksConflict } from "./locks"

describe("locksConflict — extended", () => {
	describe("filesystem locks", () => {
		it("two fs-write on same path conflict", () => {
			expect(locksConflict("fs-write:/src/app", "fs-write:/src/app")).toBe(true)
		})

		it("nested fs-write paths conflict (parent/child)", () => {
			expect(locksConflict("fs-write:/src", "fs-write:/src/app")).toBe(true)
			expect(locksConflict("fs-write:/src/app", "fs-write:/src")).toBe(true)
		})

		it("sibling fs-write paths do not conflict", () => {
			expect(locksConflict("fs-write:/src/app", "fs-write:/src/lib")).toBe(false)
		})

		it("fs-read vs fs-read never conflict", () => {
			expect(locksConflict("fs-read:/src/app", "fs-read:/src/app")).toBe(false)
		})

		it("fs-read vs fs-write on same path conflict", () => {
			expect(locksConflict("fs-read:/src/app", "fs-write:/src/app")).toBe(true)
		})

		it("fs-read vs fs-write on different paths do not conflict", () => {
			expect(locksConflict("fs-read:/src/docs", "fs-write:/src/app")).toBe(false)
		})
	})

	describe("same-kind singleton locks", () => {
		it("computer-desktop always conflicts with computer-desktop", () => {
			expect(locksConflict("computer-desktop", "computer-desktop")).toBe(true)
		})

		it("memory-write always conflicts with memory-write", () => {
			expect(locksConflict("memory-write", "memory-write")).toBe(true)
		})
	})

	describe("cross-kind non-conflicts", () => {
		it("fs-write vs computer-desktop do not conflict", () => {
			expect(locksConflict("fs-write:/src/app", "computer-desktop")).toBe(false)
		})

		it("fs-write vs memory-write do not conflict", () => {
			expect(locksConflict("fs-write:/src/app", "memory-write")).toBe(false)
		})

		it("sandbox-workdir vs memory-write do not conflict", () => {
			expect(locksConflict("sandbox-workdir:/", "memory-write")).toBe(false)
		})

		it("integration-write vs fs-write do not conflict", () => {
			expect(locksConflict("integration-write:gmail", "fs-write:/src/app")).toBe(false)
		})
	})

	describe("sandbox-workdir locks", () => {
		it("same sandbox path conflicts", () => {
			expect(locksConflict("sandbox-workdir:/workspace", "sandbox-workdir:/workspace")).toBe(true)
		})

		it("nested sandbox paths conflict (parent/child)", () => {
			expect(locksConflict("sandbox-workdir:/workspace", "sandbox-workdir:/workspace/src")).toBe(
				true,
			)
		})

		it("non-overlapping sandbox paths do not conflict", () => {
			expect(locksConflict("sandbox-workdir:/a", "sandbox-workdir:/b")).toBe(false)
		})
	})

	describe("integration-write locks", () => {
		it("same scope conflicts", () => {
			expect(locksConflict("integration-write:gmail", "integration-write:gmail")).toBe(true)
		})

		it("prefixed scope conflicts", () => {
			expect(locksConflict("integration-write:gmail", "integration-write:gmail:send")).toBe(true)
		})

		it("different scope does not conflict", () => {
			expect(locksConflict("integration-write:gmail", "integration-write:slack")).toBe(false)
		})
	})

	describe("path normalization", () => {
		it("trailing slashes are normalized", () => {
			expect(locksConflict("fs-write:/src/app/", "fs-write:/src/app")).toBe(true)
		})

		it("double slashes are collapsed", () => {
			expect(locksConflict("fs-write:/src//app", "fs-write:/src/app")).toBe(true)
		})
	})
})

describe("buildReadyBatch — extended", () => {
	it("respects maxParallelAgents limit", () => {
		const tasks = [
			makeTask({ id: "a", resourceLocks: [] }),
			makeTask({ id: "b", resourceLocks: [] }),
			makeTask({ id: "c", resourceLocks: [] }),
			makeTask({ id: "d", resourceLocks: [] }),
		]
		const batch = buildReadyBatch(tasks, new Map(), [], 2)
		expect(batch).toHaveLength(2)
	})

	it("excludes tasks conflicting with inFlight locks", () => {
		const inFlight = [makeTask({ id: "running-1", resourceLocks: ["fs-write:/src/app"] })]
		const pending = [
			makeTask({ id: "a", resourceLocks: ["fs-write:/src/app/component"] }),
			makeTask({ id: "b", resourceLocks: ["fs-write:/src/lib"] }),
		]
		const batch = buildReadyBatch(pending, new Map(), inFlight, 5)
		expect(batch.map((t) => t.id)).toEqual(["b"])
	})

	it("excludes tasks with unsatisfied dependencies", () => {
		const pending = [
			makeTask({ id: "a", dependencies: ["missing-dep"] }),
			makeTask({ id: "b", dependencies: [] }),
		]
		const batch = buildReadyBatch(pending, new Map(), [], 5)
		expect(batch.map((t) => t.id)).toEqual(["b"])
	})

	it("allows tasks whose dependencies completed successfully", () => {
		const completed = new Map([["dep-1", makeResult({ taskId: "dep-1", status: "completed" })]])
		const pending = [makeTask({ id: "a", dependencies: ["dep-1"] })]
		const batch = buildReadyBatch(pending, completed, [], 5)
		expect(batch.map((t) => t.id)).toEqual(["a"])
	})

	it("blocks tasks whose dependency failed", () => {
		const completed = new Map([["dep-1", makeResult({ taskId: "dep-1", status: "failed" })]])
		const pending = [makeTask({ id: "a", dependencies: ["dep-1"] })]
		const batch = buildReadyBatch(pending, completed, [], 5)
		expect(batch).toHaveLength(0)
	})

	it("blocks tasks whose dependency escalated", () => {
		const completed = new Map([["dep-1", makeResult({ taskId: "dep-1", status: "escalate" })]])
		const pending = [makeTask({ id: "a", dependencies: ["dep-1"] })]
		const batch = buildReadyBatch(pending, completed, [], 5)
		expect(batch).toHaveLength(0)
	})

	it("batch tasks do not conflict with each other", () => {
		const pending = [
			makeTask({ id: "a", resourceLocks: ["fs-write:/src/app"] }),
			makeTask({ id: "b", resourceLocks: ["fs-write:/src/app/sub"] }),
			makeTask({ id: "c", resourceLocks: ["fs-write:/src/lib"] }),
		]
		const batch = buildReadyBatch(pending, new Map(), [], 5)
		const ids = batch.map((t) => t.id)
		expect(ids).toContain("a")
		expect(ids).not.toContain("b") // conflicts with a
		expect(ids).toContain("c")
	})

	it("returns empty batch when all tasks have unmet dependencies", () => {
		const pending = [
			makeTask({ id: "a", dependencies: ["nonexistent"] }),
			makeTask({ id: "b", dependencies: ["also-nonexistent"] }),
		]
		const batch = buildReadyBatch(pending, new Map(), [], 5)
		expect(batch).toHaveLength(0)
	})
})
