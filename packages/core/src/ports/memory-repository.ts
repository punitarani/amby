import { Context, type Effect } from "effect"
import type { Memory, MemoryCategory, MemoryItem, MemorySearchResult } from "../domain/memory"
import type { CoreError } from "../errors/core-error"

export interface MemoryRepository {
	readonly add: (params: {
		userId: string
		content: string
		category?: MemoryCategory
		source?: string
		metadata?: Record<string, unknown>
	}) => Effect.Effect<string, CoreError>

	readonly getProfile: (
		userId: string,
	) => Effect.Effect<{ static: MemoryItem[]; dynamic: MemoryItem[] }, CoreError>

	readonly search: (
		userId: string,
		query: string,
		options?: { limit?: number },
	) => Effect.Effect<MemorySearchResult[], CoreError>

	readonly deactivate: (id: string) => Effect.Effect<void, CoreError>

	readonly findById: (id: string) => Effect.Effect<Memory | undefined, CoreError>
}

export class MemoryRepo extends Context.Tag("MemoryRepo")<MemoryRepo, MemoryRepository>() {}
