import type { Database } from "@amby/db"
import { and, eq, lte, ne, schema } from "@amby/db"
import type { Daytona, Sandbox } from "@daytonaio/sdk"
import { DaytonaError, DaytonaNotFoundError } from "@daytonaio/sdk"
import { Effect } from "effect"
import { COMPUTER_SNAPSHOT } from "../computer-snapshot"
import {
	sandboxName,
	VOLUME_CODEX_HOME,
	VOLUME_DESKTOP_DIR,
	VOLUME_DOCUMENTS_DIR,
	VOLUME_DOWNLOADS_DIR,
	VOLUME_MOUNT_PATH,
	VOLUME_TASK_BASE,
	volumeName,
	wait,
} from "../config"
import { SandboxError, VolumeError } from "../errors"
import {
	inferDbStatusFromSandbox,
	type SandboxDbStatus,
	tryGetSandboxByName,
	waitForSandboxStarted,
} from "./resolve-sandbox"

type VolumeRow = typeof schema.userVolumes.$inferSelect
type DaytonaVolume = Awaited<ReturnType<Daytona["volume"]["get"]>>

const ENV_SETUP_MESSAGE =
	"Your computer environment is still being set up. Storage provisioning can take a few minutes, so please try again shortly."
const SANDBOX_START_MESSAGE =
	"Your computer is starting up. This usually takes a minute or two; please try again shortly."
const DEFAULT_VOLUME_READY_TIMEOUT_MS = 20 * 60 * 1000
const DEFAULT_VOLUME_POLL_INTERVAL_MS = 1_000
const DEFAULT_SANDBOX_POLL_INTERVAL_MS = 1_000

const MOUNTED_HOME_DIRS = [
	VOLUME_MOUNT_PATH,
	VOLUME_DESKTOP_DIR,
	VOLUME_DOCUMENTS_DIR,
	VOLUME_DOWNLOADS_DIR,
	VOLUME_CODEX_HOME,
	VOLUME_TASK_BASE,
]

function mapVolumeStateToDbStatus(state: string): VolumeRow["status"] {
	if (state === "ready") return "ready"
	if (
		state === "creating" ||
		state === "pending_create" ||
		state === "deleting" ||
		state === "pending_delete"
	) {
		return "creating"
	}
	if (state === "deleted") return "deleted"
	return "error"
}

function isVolumeReady(status: VolumeRow["status"]): boolean {
	return status === "ready"
}

function isVolumeProvisioning(status: VolumeRow["status"]): boolean {
	return status === "creating"
}

function isVolumeUnavailable(status: VolumeRow["status"]): boolean {
	return status === "error" || status === "deleted"
}

async function tryGetVolumeByName(daytona: Daytona, name: string): Promise<DaytonaVolume | null> {
	try {
		return await daytona.volume.get(name)
	} catch (cause) {
		if (cause instanceof DaytonaNotFoundError) return null
		if (cause instanceof DaytonaError && cause.statusCode === 404) return null
		throw cause
	}
}

async function safeDeleteVolume(daytona: Daytona, volume: DaytonaVolume): Promise<void> {
	try {
		await daytona.volume.delete(volume)
	} catch (cause) {
		if (cause instanceof DaytonaNotFoundError) return
		if (cause instanceof DaytonaError && cause.statusCode === 404) return
		throw cause
	}
}

async function getOrCreateVolume(daytona: Daytona, name: string): Promise<DaytonaVolume> {
	const existing = await tryGetVolumeByName(daytona, name)
	if (existing) return existing
	return await daytona.volume.create(name)
}

/** Get or (re)create a volume, replacing any in error/deleted state. */
async function resolveHealthyVolume(daytona: Daytona, name: string): Promise<DaytonaVolume> {
	const existing = await tryGetVolumeByName(daytona, name)
	if (existing && existing.state !== "error" && existing.state !== "deleted") return existing
	if (existing) await safeDeleteVolume(daytona, existing)
	return await daytona.volume.create(name)
}

async function upsertVolumeRow(
	db: Database,
	userId: string,
	daytonaVolumeId: string,
	status: VolumeRow["status"],
): Promise<VolumeRow> {
	const rows = await db
		.insert(schema.userVolumes)
		.values({
			userId,
			daytonaVolumeId,
			status,
		})
		.onConflictDoUpdate({
			target: schema.userVolumes.userId,
			set: {
				daytonaVolumeId,
				status,
				updatedAt: new Date(),
			},
		})
		.returning()

	const row = rows[0]
	if (!row) {
		throw new Error(`Failed to upsert volume row for user ${userId}.`)
	}
	return row
}

export async function ensureVolume(
	daytona: Daytona,
	db: Database,
	userId: string,
	isDev: boolean,
): Promise<VolumeRow> {
	const name = volumeName(userId, isDev)

	try {
		const volume = await getOrCreateVolume(daytona, name)
		return await upsertVolumeRow(db, userId, volume.id, mapVolumeStateToDbStatus(volume.state))
	} catch (cause) {
		throw new VolumeError({
			message: `Failed to ensure volume for user ${userId}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		})
	}
}

export async function ensureProvisionableVolume(
	daytona: Daytona,
	db: Database,
	userId: string,
	isDev: boolean,
): Promise<VolumeRow> {
	try {
		const volume = await resolveHealthyVolume(daytona, volumeName(userId, isDev))
		return await upsertVolumeRow(db, userId, volume.id, mapVolumeStateToDbStatus(volume.state))
	} catch (cause) {
		throw new VolumeError({
			message: `Failed to provision volume for user ${userId}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		})
	}
}

export async function waitForVolumeReady(
	daytona: Daytona,
	db: Database,
	userId: string,
	isDev: boolean,
	options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<VolumeRow> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_VOLUME_READY_TIMEOUT_MS
	const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_VOLUME_POLL_INTERVAL_MS
	const deadline = Date.now() + timeoutMs
	const name = volumeName(userId, isDev)
	const seen = { state: "" }

	while (Date.now() < deadline) {
		const volume = await resolveHealthyVolume(daytona, name)
		const status = mapVolumeStateToDbStatus(volume.state)

		if (status === "ready") {
			return await upsertVolumeRow(db, userId, volume.id, "ready")
		}

		// Only write to DB when the Daytona state changes
		if (volume.state !== seen.state) {
			seen.state = volume.state
			await upsertVolumeRow(db, userId, volume.id, status)
		}

		await wait(pollIntervalMs)
	}

	throw new VolumeError({
		message: `Timed out waiting for volume readiness for user ${userId}. Last known status: ${seen.state || "unknown"}.`,
	})
}

export function sandboxHasExpectedVolume(sandbox: Sandbox, daytonaVolumeId: string): boolean {
	return (
		sandbox.volumes?.some(
			(volume) => volume.volumeId === daytonaVolumeId && volume.mountPath === VOLUME_MOUNT_PATH,
		) ?? false
	)
}

export async function ensureMountedHomeLayout(sandbox: Sandbox): Promise<void> {
	await sandbox.process.executeCommand(`mkdir -p ${MOUNTED_HOME_DIRS.join(" ")}`)
}

export async function upsertMainSandboxRow(
	db: Database,
	userId: string,
	daytonaSandboxId: string | null,
	status: SandboxDbStatus,
	volumeId: string,
	snapshot?: string | null,
) {
	const now = new Date()

	await db
		.insert(schema.sandboxes)
		.values({
			userId,
			daytonaSandboxId,
			volumeId,
			role: "main",
			status,
			snapshot,
			lastActivityAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [schema.sandboxes.userId, schema.sandboxes.role],
			targetWhere: and(eq(schema.sandboxes.role, "main"), ne(schema.sandboxes.status, "deleted")),
			set: {
				daytonaSandboxId,
				volumeId,
				status,
				snapshot,
				lastActivityAt: now,
				updatedAt: now,
			},
		})
}

async function persistMainSandboxFromInstance(
	db: Database,
	userId: string,
	sandbox: Sandbox,
	volumeId: string,
	status?: SandboxDbStatus,
	snapshot?: string | null,
) {
	await sandbox.refreshData()
	await upsertMainSandboxRow(
		db,
		userId,
		sandbox.id,
		status ?? inferDbStatusFromSandbox(sandbox),
		volumeId,
		snapshot,
	)
}

export interface EnsureMainSandboxParams {
	daytona: Daytona
	db: Database
	userId: string
	isDev: boolean
	cache: Map<string, Sandbox>
}

export const ensureMainSandbox = (
	params: EnsureMainSandboxParams,
): Effect.Effect<Sandbox, SandboxError> =>
	Effect.gen(function* () {
		const { daytona, db, userId, isDev, cache } = params
		const name = sandboxName(userId, isDev)

		const volumeRow = yield* Effect.tryPromise({
			try: () => ensureVolume(daytona, db, userId, isDev),
			catch: (cause) =>
				new SandboxError({
					message: `Failed to resolve volume record: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				}),
		})

		const adoptSandbox = async (sandbox: Sandbox) => {
			const readySandbox = await waitForSandboxStarted(sandbox, {
				pollIntervalMs: DEFAULT_SANDBOX_POLL_INTERVAL_MS,
			})
			await ensureMountedHomeLayout(readySandbox)
			cache.set(userId, readySandbox)
			await persistMainSandboxFromInstance(
				db,
				userId,
				readySandbox,
				volumeRow.id,
				"running",
				COMPUTER_SNAPSHOT,
			)
			return readySandbox
		}

		if (isVolumeReady(volumeRow.status)) {
			const cached = cache.get(userId)
			if (cached) {
				const fromCache = yield* Effect.either(
					Effect.tryPromise({
						try: async () => {
							await cached.refreshData()
							if (!sandboxHasExpectedVolume(cached, volumeRow.daytonaVolumeId)) return null
							if (inferDbStatusFromSandbox(cached) === "error") return null
							return await adoptSandbox(cached)
						},
						catch: () => new SandboxError({ message: "Cache refresh failed" }),
					}),
				)
				if (fromCache._tag === "Right" && fromCache.right) return fromCache.right
				cache.delete(userId)
			}

			const existing = yield* Effect.tryPromise({
				try: async () => {
					const sandbox = await tryGetSandboxByName(daytona, name)
					if (!sandbox) return null
					await sandbox.refreshData()
					return sandbox
				},
				catch: (cause) =>
					new SandboxError({
						message: `Failed to resolve sandbox by name: ${cause instanceof Error ? cause.message : String(cause)}`,
						cause,
					}),
			})

			if (
				existing &&
				sandboxHasExpectedVolume(existing, volumeRow.daytonaVolumeId) &&
				inferDbStatusFromSandbox(existing) !== "error"
			) {
				return yield* Effect.tryPromise({
					try: () => adoptSandbox(existing),
					catch: (cause) =>
						new SandboxError({
							message: `Failed to start existing sandbox: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				})
			}
		}

		yield* Effect.tryPromise({
			try: () =>
				upsertMainSandboxRow(
					db,
					userId,
					null,
					isVolumeReady(volumeRow.status) ? "creating" : "volume_creating",
					volumeRow.id,
				),
			catch: (cause) =>
				new SandboxError({
					message: `Failed to update sandbox provisioning status: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				}),
		})

		return yield* Effect.fail(
			new SandboxError({
				message:
					isVolumeProvisioning(volumeRow.status) || isVolumeUnavailable(volumeRow.status)
						? ENV_SETUP_MESSAGE
						: SANDBOX_START_MESSAGE,
				transient: true,
			}),
		)
	})

export const PROVISION_WORKFLOW_THROTTLE_MS = 15_000

/**
 * Start a sandbox-provision workflow if one isn't already running for this user.
 *
 * Deduplication uses an atomic UPDATE-as-lock: only the request that successfully
 * bumps `updatedAt` past the throttle window proceeds to create a workflow.
 * First-time users (no sandbox row yet) bypass the lock — the workflow itself
 * handles the race via idempotent upserts.
 */
export async function kickOffSandboxProvisionIfNeeded(
	db: Database,
	userId: string,
	createWorkflow: () => Promise<unknown>,
): Promise<void> {
	const now = new Date()
	const throttleCutoff = new Date(now.getTime() - PROVISION_WORKFLOW_THROTTLE_MS)

	// Atomically claim the provisioning slot by bumping updatedAt.
	// Succeeds only if the sandbox needs provisioning AND no other request
	// claimed the slot within the throttle window.
	const claimed = await db
		.update(schema.sandboxes)
		.set({ updatedAt: now })
		.where(
			and(
				eq(schema.sandboxes.userId, userId),
				eq(schema.sandboxes.role, "main"),
				ne(schema.sandboxes.status, "deleted"),
				ne(schema.sandboxes.status, "running"),
				ne(schema.sandboxes.status, "stopped"),
				ne(schema.sandboxes.status, "archived"),
				lte(schema.sandboxes.updatedAt, throttleCutoff),
			),
		)
		.returning({ id: schema.sandboxes.id })

	if (claimed.length > 0) {
		await createWorkflow()
		return
	}

	// No row was updated — either the sandbox is healthy, throttle hasn't
	// expired, or no row exists yet. Only proceed for first-time users.
	const exists = await db
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

	if (exists.length > 0) return

	// First-time user with no sandbox row — start provisioning.
	await createWorkflow()
}

export async function getMainVolumeRow(db: Database, userId: string): Promise<VolumeRow | null> {
	return (
		(await db
			.select()
			.from(schema.userVolumes)
			.where(eq(schema.userVolumes.userId, userId))
			.limit(1)
			.then((rows) => rows[0])) ?? null
	)
}
