import type { Database } from "@amby/db"
import { and, eq, schema } from "@amby/db"
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
		try {
			await daytona.volume.get(existing.daytonaVolumeId)
			return existing
		} catch {
			// Volume gone from Daytona — fall through to re-create
		}
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
		// Mark row as error if it exists
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

// ── Sandbox upsert (partial-unique-index aware) ─────────────────────────

/** Upsert the main sandbox row. Works with the partial unique index on (userId, role='main'). */
async function upsertMainSandboxRow(
	db: Database,
	userId: string,
	daytonaSandboxId: string,
	status: "creating" | "running" | "stopped" | "archived" | "error",
	volumeId?: string | null,
) {
	const existing = await db
		.select({ id: schema.sandboxes.id })
		.from(schema.sandboxes)
		.where(and(eq(schema.sandboxes.userId, userId), eq(schema.sandboxes.role, "main")))
		.limit(1)
		.then((rows) => rows[0])

	if (existing) {
		await db
			.update(schema.sandboxes)
			.set({
				daytonaSandboxId,
				status,
				lastActivityAt: new Date(),
				updatedAt: new Date(),
				...(volumeId != null ? { volumeId } : {}),
			})
			.where(eq(schema.sandboxes.id, existing.id))
	} else {
		await db.insert(schema.sandboxes).values({
			userId,
			daytonaSandboxId,
			status,
			role: "main",
			...(volumeId != null ? { volumeId } : {}),
		})
	}
}

/** Refresh metadata and persist sandbox row with volume link. */
async function persistMainSandboxFromInstance(
	db: Database,
	userId: string,
	sandbox: Sandbox,
	status?: "creating" | "running" | "stopped" | "archived" | "error",
	volumeId?: string | null,
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
 * Single ensure path: volume → cache → get-by-name → create.
 * The volume is always ensured first; the sandbox is created with a volume mount.
 */
export const ensureMainSandbox = (
	params: EnsureMainSandboxParams,
): Effect.Effect<Sandbox, SandboxError | VolumeError> =>
	Effect.gen(function* () {
		const { daytona, db, userId, isDev, cache } = params
		const name = sandboxName(userId, isDev)

		// Step 1: ensure volume
		const volumeRow = yield* Effect.tryPromise({
			try: () => ensureVolume(daytona, db, userId, isDev),
			catch: (cause) =>
				cause instanceof VolumeError
					? cause
					: new VolumeError({
							message: `Volume ensure failed: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
		})

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
							await persistMainSandboxFromInstance(db, userId, cached, "running", volumeRow.id)
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
					await persistMainSandboxFromInstance(db, userId, existing, "running", volumeRow.id)
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
					.where(and(eq(schema.sandboxes.userId, userId), eq(schema.sandboxes.role, "main")))
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
				}),
			)
		}

		// Clear stale main sandbox DB row if present
		if (record) {
			yield* Effect.tryPromise({
				try: () =>
					db
						.delete(schema.sandboxes)
						.where(and(eq(schema.sandboxes.userId, userId), eq(schema.sandboxes.role, "main"))),
				catch: (cause) =>
					new SandboxError({
						message: `Failed to clear stale sandbox record: ${cause instanceof Error ? cause.message : String(cause)}`,
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
					await persistMainSandboxFromInstance(db, userId, s, "running", volumeRow.id)
					return s
				} catch (cause) {
					if (isDuplicateSandboxNameError(cause)) {
						const recovered = await tryGetSandboxByName(daytona, name)
						if (recovered) {
							await startSandboxIfNeeded(recovered)
							cache.set(userId, recovered)
							await persistMainSandboxFromInstance(db, userId, recovered, "running", volumeRow.id)
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

// ── Replace sandbox ─────────────────────────────────────────────────────

/**
 * Delete a broken sandbox and create a new one on the same volume.
 * Used when a sandbox is in an unrecoverable error state.
 */
export async function replaceSandbox(
	daytona: Daytona,
	db: Database,
	userId: string,
	failedName: string,
	volumeRow: VolumeRow,
	isDev: boolean,
	cache: Map<string, Sandbox>,
): Promise<Sandbox> {
	// Best-effort delete failed sandbox from Daytona (ignore 404)
	try {
		const failed = await tryGetSandboxByName(daytona, failedName)
		if (failed) await daytona.delete(failed)
	} catch {
		// Ignore — sandbox may already be gone
	}

	// Delete main sandbox DB row (preserve secondary sandboxes)
	await db
		.delete(schema.sandboxes)
		.where(and(eq(schema.sandboxes.userId, userId), eq(schema.sandboxes.role, "main")))

	// Create new sandbox with same volume mount
	const createSpec = {
		...buildSandboxCreateParams(userId, isDev),
		volumes: [{ volumeId: volumeRow.daytonaVolumeId, mountPath: VOLUME_MOUNT_PATH }],
	}

	let sandbox: Sandbox
	try {
		sandbox = await daytona.create(createSpec, { timeout: SANDBOX_CREATE_TIMEOUT })
	} catch (cause) {
		await upsertMainSandboxRow(db, userId, "pending", "error", volumeRow.id)
		throw cause
	}
	cache.set(userId, sandbox)
	await persistMainSandboxFromInstance(db, userId, sandbox, "running", volumeRow.id)
	return sandbox
}
