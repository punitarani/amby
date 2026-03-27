import { Context, type Effect } from "effect"
import type { ComputeInstanceStatus, ComputeVolume, VolumeStatus } from "../domain/compute"
import type { DbError } from "../errors/core-error"

export interface ComputeStoreService {
	/** Get the volume row for a user. */
	readonly getVolume: (userId: string) => Effect.Effect<ComputeVolume | null, DbError>

	/**
	 * Insert-or-update a volume row (conflict on userId).
	 * Returns the resulting row.
	 */
	readonly upsertVolume: (
		userId: string,
		externalVolumeId: string,
		status: VolumeStatus,
	) => Effect.Effect<ComputeVolume, DbError>

	/**
	 * Insert-or-update the main sandbox (compute instance) row.
	 * Conflict target: (userId, role) where role='main' and status!='deleted'.
	 */
	readonly upsertMainInstance: (params: {
		userId: string
		externalInstanceId: string | null
		status: ComputeInstanceStatus
		volumeId: string
		snapshot?: string | null
	}) => Effect.Effect<void, DbError>

	/**
	 * Atomic provision-slot claim. Returns true if the caller won the lock
	 * (the sandbox needs provisioning and no other caller claimed it recently).
	 */
	readonly claimProvisionSlot: (
		userId: string,
		throttleCutoff: Date,
	) => Effect.Effect<boolean, DbError>

	/**
	 * Check whether a main (non-deleted) compute instance row exists for the user.
	 */
	readonly mainInstanceExists: (userId: string) => Effect.Effect<boolean, DbError>

	/** Read the authConfig JSON from the volume row for a user. */
	readonly loadAuthConfig: (userId: string) => Effect.Effect<unknown, DbError>

	/** Update the authConfig JSON on the volume row for a user. */
	readonly saveAuthConfig: (userId: string, authConfig: unknown) => Effect.Effect<void, DbError>
}

export class ComputeStore extends Context.Tag("ComputeStore")<
	ComputeStore,
	ComputeStoreService
>() {}
