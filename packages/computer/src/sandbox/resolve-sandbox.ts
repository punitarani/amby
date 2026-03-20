import type { Database } from "@amby/db"
import { eq, schema } from "@amby/db"
import type { Daytona } from "@daytonaio/sdk"
import type { Sandbox } from "@daytonaio/sdk"
import { DaytonaError, DaytonaNotFoundError } from "@daytonaio/sdk"
import { Effect, Either } from "effect"
import {
	AGENT_USER,
	AUTO_ARCHIVE_MINUTES,
	AUTO_STOP_MINUTES,
	SANDBOX_CREATE_TIMEOUT,
	SANDBOX_RESOURCES,
	SANDBOX_START_TIMEOUT,
	sandboxLabels,
	sandboxName,
} from "../config"
import { sandboxImage as defaultSandboxImage } from "./sandbox-image"
import { SandboxError } from "../errors"

export type SandboxDbStatus = "creating" | "running" | "stopped" | "archived" | "error"

/** Spec passed to `daytona.create` — shared by SandboxService and provision workflow */
export function buildSandboxCreateParams(
	userId: string,
	isDev: boolean,
	image: typeof defaultSandboxImage = defaultSandboxImage,
) {
	const name = sandboxName(userId, isDev)
	return {
		name,
		image,
		resources: SANDBOX_RESOURCES,
		autoStopInterval: AUTO_STOP_MINUTES,
		autoArchiveInterval: AUTO_ARCHIVE_MINUTES,
		labels: sandboxLabels(userId, isDev),
		user: AGENT_USER,
	}
}

export function isDuplicateSandboxNameError(cause: unknown): boolean {
	const msg = cause instanceof Error ? cause.message : String(cause)
	return /already exists/i.test(msg)
}

function primaryVolumeId(sandbox: Sandbox): string | null {
	const v = sandbox.volumes?.[0]
	return v?.volumeId ?? null
}

/** Upsert sandbox row with optional volume id from the resolved Sandbox object */
export async function upsertSandboxRow(
	db: Database,
	userId: string,
	daytonaSandboxId: string,
	status: SandboxDbStatus,
	volumeId?: string | null,
) {
	await db
		.insert(schema.sandboxes)
		.values({
			userId,
			daytonaSandboxId,
			status,
			...(volumeId != null ? { daytonaVolumeId: volumeId } : {}),
		})
		.onConflictDoUpdate({
			target: schema.sandboxes.userId,
			set: {
				daytonaSandboxId,
				status,
				lastActivityAt: new Date(),
				...(volumeId != null ? { daytonaVolumeId: volumeId } : {}),
			},
		})
}

/** Map Daytona sandbox state to our DB status column */
export function inferDbStatusFromSandbox(sandbox: Sandbox): SandboxDbStatus {
	const s = sandbox.state
	if (s === "archived" || s === "archiving") return "archived"
	if (s === "stopped" || s === "stopping") return "stopped"
	if (s === "error" || s === "build_failed") return "error"
	return "running"
}

/** Refresh metadata and persist id, volume, and status */
export async function persistSandboxFromInstance(
	db: Database,
	userId: string,
	sandbox: Sandbox,
	status?: SandboxDbStatus,
) {
	await sandbox.refreshData()
	const st = status ?? inferDbStatusFromSandbox(sandbox)
	const vol = primaryVolumeId(sandbox)
	await upsertSandboxRow(db, userId, sandbox.id, st, vol)
}

/**
 * Returns the sandbox if it exists in Daytona, otherwise null (404 only — other errors propagate).
 */
export async function tryGetSandboxByName(daytona: Daytona, name: string): Promise<Sandbox | null> {
	try {
		return await daytona.get(name)
	} catch (cause) {
		if (cause instanceof DaytonaNotFoundError) return null
		if (cause instanceof DaytonaError && cause.statusCode === 404) return null
		throw cause
	}
}

async function startSandboxIfNeeded(sandbox: Sandbox): Promise<void> {
	await sandbox.refreshData()
	if (sandbox.state === "started") return
	await sandbox.start(SANDBOX_START_TIMEOUT)
}

/**
 * Resolve an existing sandbox by name, start it, cache, and persist — shared ensure path.
 */
export async function resolveExistingSandboxByName(
	daytona: Daytona,
	db: Database,
	userId: string,
	name: string,
	cache: Map<string, Sandbox>,
): Promise<Sandbox | null> {
	const existing = await tryGetSandboxByName(daytona, name)
	if (!existing) return null
	await startSandboxIfNeeded(existing)
	cache.set(userId, existing)
	await persistSandboxFromInstance(db, userId, existing, "running")
	return existing
}

const mapToSandboxError =
	(context: string) =>
	(cause: unknown): SandboxError =>
		new SandboxError({
			message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		})

const passThroughSandboxError = (cause: unknown): SandboxError =>
	cause instanceof SandboxError
		? cause
		: new SandboxError({
				message: `Failed to ensure sandbox: ${cause instanceof Error ? cause.message : String(cause)}`,
				cause,
			})

export interface EnsureSandboxParams {
	daytona: Daytona
	db: Database
	userId: string
	name: string
	isDev: boolean
	cache: Map<string, Sandbox>
}

/**
 * Fast path: return a ready cached sandbox, or `undefined` to fall through to {@link ensureSandboxStarted}.
 * Cache refresh failures clear the entry and yield `undefined` (never fails the caller).
 */
export const tryCacheSandbox = (
	cache: Map<string, Sandbox>,
	userId: string,
	db: Database,
): Effect.Effect<Sandbox | undefined, never> =>
	Effect.gen(function* () {
		const cached = cache.get(userId)
		if (!cached) return undefined

		const outcome = yield* Effect.either(
			Effect.tryPromise({
				try: async () => {
					await cached.refreshData()
					if (cached.state === "started") return cached
					if (cached.state === "stopped" || cached.state === "error") {
						await cached.start(SANDBOX_START_TIMEOUT)
						await persistSandboxFromInstance(db, userId, cached, "running")
						return cached
					}
					return undefined
				},
				catch: (cause) => cause,
			}),
		)

		if (Either.isLeft(outcome)) {
			cache.delete(userId)
			return undefined
		}

		return outcome.right
	})

/**
 * Core get-or-create for {@link SandboxService.ensure}: get-by-name first, then create with duplicate recovery.
 */
export const ensureSandboxStarted = (params: EnsureSandboxParams): Effect.Effect<Sandbox, SandboxError> =>
	Effect.gen(function* () {
		const { daytona, db, userId, name, cache, isDev } = params
		const createSpec = buildSandboxCreateParams(userId, isDev)

		const resolved = yield* Effect.tryPromise({
			try: () => resolveExistingSandboxByName(daytona, db, userId, name, cache),
			catch: mapToSandboxError("Failed to resolve sandbox by name"),
		})
		if (resolved) return resolved

		const record = yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(schema.sandboxes)
					.where(eq(schema.sandboxes.userId, userId))
					.limit(1)
					.then((rows) => rows[0]),
			catch: mapToSandboxError("Failed to load sandbox record"),
		})

		if (record?.status === "creating") {
			yield* Effect.fail(
				new SandboxError({
					message:
						"Your sandbox is being set up — this usually takes a few minutes. Please try again shortly.",
				}),
			)
		}

		if (record) {
			yield* Effect.tryPromise({
				try: () => db.delete(schema.sandboxes).where(eq(schema.sandboxes.userId, userId)),
				catch: mapToSandboxError("Failed to clear stale sandbox record"),
			})
		}

		yield* Effect.tryPromise({
			try: () => upsertSandboxRow(db, userId, "pending", "creating"),
			catch: mapToSandboxError("Failed to mark sandbox as creating"),
		})

		const sandbox = yield* Effect.tryPromise({
			try: async () => {
				try {
					const s = await daytona.create(createSpec, { timeout: SANDBOX_CREATE_TIMEOUT })
					cache.set(userId, s)
					await persistSandboxFromInstance(db, userId, s, "running")
					return s
				} catch (cause) {
					if (isDuplicateSandboxNameError(cause)) {
						const recovered = await resolveExistingSandboxByName(daytona, db, userId, name, cache)
						if (recovered) return recovered
					}
					await upsertSandboxRow(db, userId, "pending", "error")
					throw cause
				}
			},
			catch: passThroughSandboxError,
		})

		return sandbox
	})
