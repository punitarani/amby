import type { Database } from "@amby/db"
import { and, eq, ne, schema } from "@amby/db"
import type { Daytona, Sandbox } from "@daytonaio/sdk"
import { Effect } from "effect"
import {
	SANDBOX_CREATE_TIMEOUT,
	SANDBOX_START_TIMEOUT,
	sandboxName,
	VOLUME_MOUNT_PATH,
	volumeName,
} from "../config"
import { SandboxError, VolumeError } from "../errors"
import {
	buildSandboxCreateParams,
	inferDbStatusFromSandbox,
	isDuplicateSandboxNameError,
	type SandboxDbStatus,
	startSandboxIfNeeded,
	tryGetSandboxByName,
} from "./resolve-sandbox"

type VolumeRow = typeof schema.userVolumes.$inferSelect

// ── Volume lifecycle ────────────────────────────────────────────────────

/**
 * Ensure a persistent volume exists for the user.
 * Creates the volume in Daytona (auto-create via `get`) and upserts the DB row.
 */
export async function ensureVolume(
	daytona: Daytona,
	db: Database,
	userId: string,
	isDev: boolean,
): Promise<VolumeRow> {
	const existing = await db
		.select()
		.from(schema.userVolumes)
		.where(eq(schema.userVolumes.userId, userId))
		.limit(1)
		.then((rows) => rows[0])

	if (existing?.status === "ready") {
		// Trust the DB row — skip Daytona validation to avoid spurious 403/transient errors.
		// If the volume was deleted externally, sandbox creation will fail explicitly at that point.
		return existing
	}

	const name = volumeName(userId, isDev)

	try {
		// `get(name, true)` auto-creates if missing
		const volume = await daytona.volume.get(name, true)

		const rows = await db
			.insert(schema.userVolumes)
			.values({
				userId,
				daytonaVolumeId: volume.id,
				status: "ready",
			})
			.onConflictDoUpdate({
				target: schema.userVolumes.userId,
				set: {
					daytonaVolumeId: volume.id,
					status: "ready" as const,
					updatedAt: new Date(),
				},
			})
			.returning()

		// biome-ignore lint/style/noNonNullAssertion: upsert always returns a row
		return rows[0]!
	} catch (cause) {
		// Mark existing row as error so the next attempt re-creates.
		// On first-time creation failures there is no row yet — we cannot insert
		// one without a valid daytonaVolumeId (NOT NULL constraint), so the
		// failure is surfaced via VolumeError without a DB trace.
		if (existing) {
			await db
				.update(schema.userVolumes)
				.set({ status: "error" as const, updatedAt: new Date() })
				.where(eq(schema.userVolumes.userId, userId))
		}

		throw new VolumeError({
			message: `Failed to ensure volume for user ${userId}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		})
	}
}

// ── Sandbox write helpers ────────────────────────────────────────────────

/**
 * Soft-delete the active main sandbox row for a user.
 * Rows are never hard-deleted — status transitions to "deleted" instead.
 * Only affects rows that are not already marked deleted.
 *
 * The broad WHERE (userId + role='main' + status!='deleted') is intentional:
 * the partial unique index guarantees at most one active main sandbox per user,
 * so this always targets exactly zero or one row.
 */
async function softDeleteMainSandboxRow(db: Database, userId: string) {
	await db
		.update(schema.sandboxes)
		.set({ status: "deleted", updatedAt: new Date() })
		.where(
			and(
				eq(schema.sandboxes.userId, userId),
				eq(schema.sandboxes.role, "main"),
				ne(schema.sandboxes.status, "deleted"),
			),
		)
}

/** Upsert the main sandbox row atomically. Works with the partial unique index on (userId, role='main'). */
export async function upsertMainSandboxRow(
	db: Database,
	userId: string,
	daytonaSandboxId: string,
	status: SandboxDbStatus,
	volumeId: string,
) {
	await db.transaction(async (tx) => {
		const existing = await tx
			.select({ id: schema.sandboxes.id })
			.from(schema.sandboxes)
			.where(
				and(
					eq(schema.sandboxes.userId, userId),
					eq(schema.sandboxes.role, "main"),
					ne(schema.sandboxes.status, "deleted"),
				),
			)
			.limit(1)
			.then((rows) => rows[0])

		if (existing) {
			await tx
				.update(schema.sandboxes)
				.set({
					daytonaSandboxId,
					status,
					volumeId,
					lastActivityAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(schema.sandboxes.id, existing.id))
		} else {
			await tx.insert(schema.sandboxes).values({
				userId,
				daytonaSandboxId,
				status,
				role: "main",
				volumeId,
			})
		}
	})
}

/** Refresh metadata and persist sandbox row with volume link. */
async function persistMainSandboxFromInstance(
	db: Database,
	userId: string,
	sandbox: Sandbox,
	volumeId: string,
	status?: SandboxDbStatus,
) {
	await sandbox.refreshData()
	const st = status ?? inferDbStatusFromSandbox(sandbox)
	await upsertMainSandboxRow(db, userId, sandbox.id, st, volumeId)
}

// ── Main ensure path ────────────────────────────────────────────────────

export interface EnsureMainSandboxParams {
	daytona: Daytona
	db: Database
	userId: string
	isDev: boolean
	cache: Map<string, Sandbox>
}

/**
 * Single ensure path: volume (DB read-only) → cache → get-by-name → create.
 *
 * Volumes are managed exclusively by SandboxProvisionWorkflow (triggered on /start).
 * This function only reads the volume row from the DB — it never calls the Daytona
 * volume API. If no ready volume exists, it fails with a user-friendly message.
 */
export const ensureMainSandbox = (
	params: EnsureMainSandboxParams,
): Effect.Effect<Sandbox, SandboxError> =>
	Effect.gen(function* () {
		const { daytona, db, userId, isDev, cache } = params
		const name = sandboxName(userId, isDev)

		// Step 1: require an existing ready volume row (created by the provision workflow).
		// We never call the Daytona volume API here — that is the provision workflow's job.
		const volumeRow = yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(schema.userVolumes)
					.where(eq(schema.userVolumes.userId, userId))
					.limit(1)
					.then((rows) => rows[0] ?? null),
			catch: (cause) =>
				new SandboxError({
					message: `Failed to load volume record: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				}),
		})

		if (!volumeRow || volumeRow.status !== "ready") {
			return yield* Effect.fail(
				new SandboxError({
					message:
						"Your computer environment is being set up — this usually takes a few minutes. Please try again shortly.",
					transient: true,
				}),
			)
		}

		// Step 2: try cache
		const cached = cache.get(userId)
		if (cached) {
			const fromCache = yield* Effect.either(
				Effect.tryPromise({
					try: async () => {
						await cached.refreshData()
						if (cached.state === "started") return cached as Sandbox | null
						if (cached.state === "stopped" || cached.state === "error") {
							await cached.start(SANDBOX_START_TIMEOUT)
							await persistMainSandboxFromInstance(db, userId, cached, volumeRow.id, "running")
							return cached as Sandbox | null
						}
						return null
					},
					catch: () => new SandboxError({ message: "Cache refresh failed" }),
				}),
			)
			if (fromCache._tag === "Right" && fromCache.right) return fromCache.right
			cache.delete(userId)
		}

		// Step 3: try get-by-name from Daytona
		const existing = yield* Effect.tryPromise({
			try: () => tryGetSandboxByName(daytona, name),
			catch: (cause) =>
				new SandboxError({
					message: `Failed to resolve sandbox by name: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				}),
		})
		if (existing) {
			yield* Effect.tryPromise({
				try: async () => {
					await startSandboxIfNeeded(existing)
					cache.set(userId, existing)
					await persistMainSandboxFromInstance(db, userId, existing, volumeRow.id, "running")
				},
				catch: (cause) =>
					new SandboxError({
						message: `Failed to start existing sandbox: ${cause instanceof Error ? cause.message : String(cause)}`,
						cause,
					}),
			})
			return existing
		}

		// Step 4: check DB for "creating" row — bail with user message
		const record = yield* Effect.tryPromise({
			try: () =>
				db
					.select({ status: schema.sandboxes.status })
					.from(schema.sandboxes)
					.where(
						and(
							eq(schema.sandboxes.userId, userId),
							eq(schema.sandboxes.role, "main"),
							ne(schema.sandboxes.status, "deleted"),
						),
					)
					.limit(1)
					.then((rows) => rows[0]),
			catch: (cause) =>
				new SandboxError({
					message: `Failed to load sandbox record: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				}),
		})

		if (record?.status === "creating") {
			yield* Effect.fail(
				new SandboxError({
					message:
						"Your sandbox is being set up — this usually takes a few minutes. Please try again shortly.",
					transient: true,
				}),
			)
		}

		// Soft-delete stale main sandbox DB row if present
		if (record) {
			yield* Effect.tryPromise({
				try: () => softDeleteMainSandboxRow(db, userId),
				catch: (cause) =>
					new SandboxError({
						message: `Failed to retire stale sandbox record: ${cause instanceof Error ? cause.message : String(cause)}`,
						cause,
					}),
			})
		}

		// Step 5: Mark creating and create sandbox with volume mount
		yield* Effect.tryPromise({
			try: () => upsertMainSandboxRow(db, userId, "pending", "creating", volumeRow.id),
			catch: (cause) =>
				new SandboxError({
					message: `Failed to mark sandbox as creating: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				}),
		})

		const createSpec = {
			...buildSandboxCreateParams(userId, isDev),
			volumes: [{ volumeId: volumeRow.daytonaVolumeId, mountPath: VOLUME_MOUNT_PATH }],
		}

		const sandbox = yield* Effect.tryPromise({
			try: async () => {
				try {
					const s = await daytona.create(createSpec, { timeout: SANDBOX_CREATE_TIMEOUT })
					cache.set(userId, s)
					await persistMainSandboxFromInstance(db, userId, s, volumeRow.id, "running")
					return s
				} catch (cause) {
					if (isDuplicateSandboxNameError(cause)) {
						const recovered = await tryGetSandboxByName(daytona, name)
						if (recovered) {
							await startSandboxIfNeeded(recovered)
							cache.set(userId, recovered)
							await persistMainSandboxFromInstance(db, userId, recovered, volumeRow.id, "running")
							return recovered
						}
					}
					await upsertMainSandboxRow(db, userId, "pending", "error", volumeRow.id)
					throw cause
				}
			},
			catch: (cause) =>
				cause instanceof SandboxError
					? cause
					: new SandboxError({
							message: `Failed to ensure sandbox: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
		})

		return sandbox
	})
