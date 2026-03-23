import type { ExecutionTask, ExecutionTaskResult, LockGraphState } from "../types/execution"

type Lock = {
	kind: string
	scope: string
	mode?: "read" | "write"
	raw: string
}

function parseLock(raw: string): Lock {
	if (raw.startsWith("fs-read:")) {
		return { kind: "fs", scope: raw.slice("fs-read:".length), mode: "read", raw }
	}
	if (raw.startsWith("fs-write:")) {
		return { kind: "fs", scope: raw.slice("fs-write:".length), mode: "write", raw }
	}
	if (raw.startsWith("sandbox-workdir:")) {
		return { kind: "sandbox-workdir", scope: raw.slice("sandbox-workdir:".length), raw }
	}
	if (raw.startsWith("integration-write:")) {
		return { kind: "integration-write", scope: raw.slice("integration-write:".length), raw }
	}
	return { kind: raw, scope: raw, raw }
}

function normalizePath(path: string): string {
	const trimmed = path.trim()
	if (!trimmed) return "/"
	const collapsed = trimmed.replace(/\/+/g, "/")
	return collapsed.endsWith("/") && collapsed !== "/" ? collapsed.slice(0, -1) : collapsed
}

function pathsOverlap(left: string, right: string): boolean {
	const a = normalizePath(left)
	const b = normalizePath(right)
	return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function locksConflict(leftRaw: string, rightRaw: string): boolean {
	const left = parseLock(leftRaw)
	const right = parseLock(rightRaw)

	if (left.kind !== right.kind) return false

	switch (left.kind) {
		case "computer-desktop":
		case "memory-write":
			return true
		case "fs":
			if (left.mode === "read" && right.mode === "read") return false
			return pathsOverlap(left.scope, right.scope)
		case "sandbox-workdir":
			return pathsOverlap(left.scope, right.scope)
		case "integration-write":
			return left.scope === right.scope || left.scope.startsWith(`${right.scope}:`) || right.scope.startsWith(`${left.scope}:`)
		default:
			return left.scope === right.scope
	}
}

function taskConflicts(task: ExecutionTask, activeLocks: string[]): boolean {
	return task.resourceLocks.some((lock) => activeLocks.some((active) => locksConflict(lock, active)))
}

export function buildReadyBatch(
	pending: ExecutionTask[],
	completed: Map<string, ExecutionTaskResult>,
	inFlight: ExecutionTask[],
	maxParallelAgents: number,
): ExecutionTask[] {
	const activeLocks = inFlight.flatMap((task) => task.resourceLocks)
	const ready = pending.filter(
		(task) =>
			task.dependencies.every((dependencyId) => completed.has(dependencyId)) &&
			!taskConflicts(task, activeLocks),
	)

	const batch: ExecutionTask[] = []
	for (const task of ready) {
		if (batch.length >= maxParallelAgents) break
		if (taskConflicts(task, [...activeLocks, ...batch.flatMap((item) => item.resourceLocks)])) {
			continue
		}
		batch.push(task)
	}

	return batch
}

export function buildLockGraphState(
	tasks: ExecutionTask[],
	completed = new Map<string, ExecutionTaskResult>(),
	inFlight: ExecutionTask[] = [],
): LockGraphState {
	const ready = buildReadyBatch(tasks, completed, inFlight, tasks.length)
	const readyIds = new Set(ready.map((task) => task.id))

	return {
		ready,
		blocked: tasks.filter((task) => !readyIds.has(task.id)),
		inFlight,
		completed,
	}
}
