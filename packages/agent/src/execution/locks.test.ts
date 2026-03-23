import { describe, expect, it } from "bun:test"
import { buildReadyBatch, locksConflict } from "./locks"
import type { ExecutionTask } from "../types/execution"

function makeTask(partial: Partial<ExecutionTask> & Pick<ExecutionTask, "id">): ExecutionTask {
	return {
		id: partial.id,
		rootTaskId: partial.rootTaskId ?? partial.id,
		parentTaskId: partial.parentTaskId,
		depth: partial.depth ?? 1,
		specialist: partial.specialist ?? "research",
		runnerKind: partial.runnerKind ?? "toolloop",
		mode: partial.mode ?? "parallel",
		input:
			partial.input ??
			({
				kind: "specialist",
				goal: partial.id,
			} as const),
		dependencies: partial.dependencies ?? [],
		inputBindings: partial.inputBindings ?? {},
		resourceLocks: partial.resourceLocks ?? [],
		mutates: partial.mutates ?? false,
		writesExternal: partial.writesExternal ?? false,
		requiresConfirmation: partial.requiresConfirmation ?? false,
		requiresValidation: partial.requiresValidation ?? false,
	}
}

describe("execution locks", () => {
	it("treats overlapping filesystem writes as conflicting", () => {
		expect(locksConflict("fs-write:/repo/app", "fs-write:/repo/app/src")).toBe(true)
		expect(locksConflict("fs-read:/repo/docs", "fs-write:/repo/app")).toBe(false)
	})

	it("batches only non-conflicting ready tasks", () => {
		const pending = [
			makeTask({ id: "research-a", resourceLocks: [] }),
			makeTask({ id: "browser-a", specialist: "browser", runnerKind: "browser_service", resourceLocks: [] }),
			makeTask({ id: "builder-a", specialist: "builder", resourceLocks: ["fs-write:/repo/app"] }),
			makeTask({ id: "builder-b", specialist: "builder", resourceLocks: ["fs-write:/repo/app/src"] }),
			makeTask({ id: "computer-a", specialist: "computer", resourceLocks: ["computer-desktop"] }),
		]

		const batch = buildReadyBatch(pending, new Map(), [], 5)
		const ids = batch.map((task) => task.id)

		expect(ids).toContain("research-a")
		expect(ids).toContain("browser-a")
		expect(ids).toContain("builder-a")
		expect(ids).toContain("computer-a")
		expect(ids).not.toContain("builder-b")
	})
})
