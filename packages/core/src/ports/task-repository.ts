import { Context, type Effect } from "effect"
import type { Task, TaskEvent, TaskStatus } from "../domain/task"
import type { CoreError } from "../errors/core-error"

export interface TaskRepository {
	readonly create: (
		params: Omit<Task, "id" | "createdAt" | "updatedAt">,
	) => Effect.Effect<Task, CoreError>

	readonly findById: (id: string) => Effect.Effect<Task | undefined, CoreError>

	readonly findByRun: (runId: string) => Effect.Effect<Task[], CoreError>

	readonly findActiveByUser: (userId: string) => Effect.Effect<Task[], CoreError>

	readonly updateStatus: (
		id: string,
		status: TaskStatus,
		fields?: Partial<Pick<Task, "summary" | "error" | "outputJson" | "completedAt">>,
	) => Effect.Effect<void, CoreError>

	readonly appendEvent: (
		params: Omit<TaskEvent, "id" | "createdAt">,
	) => Effect.Effect<TaskEvent, CoreError>

	readonly findEvents: (
		taskId: string,
		options?: { afterSeq?: number; limit?: number },
	) => Effect.Effect<TaskEvent[], CoreError>
}

export class TaskRepo extends Context.Tag("TaskRepo")<TaskRepo, TaskRepository>() {}
