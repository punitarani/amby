import { CoreError, type MemoryRepository } from "@amby/core"
import type { Context } from "effect"
import { Effect } from "effect"
import type { MemoryService } from "./repository"

type MemoryOps = Context.Tag.Service<typeof MemoryService>

const mapError = (e: unknown) =>
	new CoreError({ message: e instanceof Error ? e.message : "Memory operation failed", cause: e })

/**
 * Adapt MemoryService (the real DB-backed implementation) to the
 * MemoryRepository port defined in @amby/core.
 *
 * The core port expects a wider interface (search, findById) that
 * MemoryService does not yet implement. Those methods return safe
 * fallbacks until the underlying service grows.
 */
export function adaptMemoryService(service: MemoryOps): MemoryRepository {
	return {
		add: ({ userId, content, category, source, metadata }) =>
			service.add(userId, content, category, source, metadata).pipe(Effect.mapError(mapError)),

		getProfile: (userId) => service.getProfile(userId).pipe(Effect.mapError(mapError)),

		search: (_userId, _query, _options) => Effect.succeed([]),

		deactivate: (id) => service.deactivate(id).pipe(Effect.mapError(mapError)),

		findById: (_id) => Effect.succeed(undefined),
	}
}
