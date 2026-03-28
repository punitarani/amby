import { DurableObject } from "cloudflare:workers"

export {
	CloudflareChatStateAdapter,
	createCloudflareChatState,
} from "../chat-state/cloudflare-chat-state"

interface CacheRow {
	expires_at: number | null
	value: string
}

function generateToken() {
	return crypto.randomUUID()
}

function readCacheRow(row: Record<string, unknown> | undefined): CacheRow | null {
	if (!row) return null
	const value = row.value
	const expiresAt = row.expires_at
	if (typeof value !== "string") return null
	if (typeof expiresAt !== "number" && expiresAt !== null) return null
	return { expires_at: expiresAt, value }
}

function readNullableExpiry(row: Record<string, unknown> | undefined) {
	if (!row) return undefined
	const expiresAt = row.expires_at
	return typeof expiresAt === "number" || expiresAt === null ? expiresAt : undefined
}

function readNextExpiry(row: Record<string, unknown> | undefined) {
	if (!row) return null
	const nextExpiry = row.next_expiry
	return typeof nextExpiry === "number" ? nextExpiry : null
}

function parseStringList(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw)
		return Array.isArray(parsed)
			? parsed.filter((entry): entry is string => typeof entry === "string")
			: []
	} catch {
		return []
	}
}

export class ChatStateDO<TEnv = unknown> extends DurableObject<TEnv> {
	private readonly sql: DurableObjectStorage["sql"]

	constructor(ctx: DurableObjectState, env: TEnv) {
		super(ctx, env)
		this.sql = ctx.storage.sql
		ctx.blockConcurrencyWhile(async () => {
			this.migrate()
		})
	}

	private migrate() {
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS _schema_version (
				version INTEGER PRIMARY KEY
			);
		`)

		const row = this.sql
			.exec("SELECT COALESCE(MAX(version), 0) as version FROM _schema_version")
			.one() as { version: number }

		if (row.version >= 1) return

		this.sql.exec(`
			CREATE TABLE subscriptions (
				thread_id TEXT PRIMARY KEY
			);

			CREATE TABLE locks (
				thread_id TEXT PRIMARY KEY,
				token TEXT NOT NULL,
				expires_at INTEGER NOT NULL
			);

			CREATE TABLE cache (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				expires_at INTEGER
			);

			CREATE INDEX idx_locks_expires ON locks(expires_at);
			CREATE INDEX idx_cache_expires ON cache(expires_at) WHERE expires_at IS NOT NULL;

			INSERT INTO _schema_version (version) VALUES (1);
		`)
	}

	subscribe(threadId: string) {
		this.sql.exec("INSERT OR IGNORE INTO subscriptions (thread_id) VALUES (?)", threadId)
	}

	unsubscribe(threadId: string) {
		this.sql.exec("DELETE FROM subscriptions WHERE thread_id = ?", threadId)
	}

	isSubscribed(threadId: string) {
		const rows = this.sql
			.exec("SELECT 1 FROM subscriptions WHERE thread_id = ? LIMIT 1", threadId)
			.toArray()
		return rows.length > 0
	}

	acquireLock(threadId: string, ttlMs: number) {
		const result = this.ctx.storage.transactionSync(() => {
			const now = Date.now()
			this.sql.exec("DELETE FROM locks WHERE thread_id = ? AND expires_at <= ?", threadId, now)
			const existing = this.sql
				.exec("SELECT 1 FROM locks WHERE thread_id = ? LIMIT 1", threadId)
				.toArray()
			if (existing.length > 0) {
				return null
			}

			const token = generateToken()
			const expiresAt = now + ttlMs
			this.sql.exec(
				"INSERT INTO locks (thread_id, token, expires_at) VALUES (?, ?, ?)",
				threadId,
				token,
				expiresAt,
			)
			return { threadId, token, expiresAt }
		})

		if (result) {
			this.scheduleCleanupIfNeeded()
		}

		return result
	}

	forceReleaseLock(threadId: string) {
		this.sql.exec("DELETE FROM locks WHERE thread_id = ?", threadId)
	}

	releaseLock(threadId: string, token: string) {
		this.sql.exec("DELETE FROM locks WHERE thread_id = ? AND token = ?", threadId, token)
	}

	extendLock(threadId: string, token: string, ttlMs: number) {
		const extended = this.ctx.storage.transactionSync(() => {
			const now = Date.now()
			const rows = this.sql
				.exec(
					`UPDATE locks
						SET expires_at = ?
						WHERE thread_id = ? AND token = ? AND expires_at > ?
						RETURNING thread_id`,
					now + ttlMs,
					threadId,
					token,
					now,
				)
				.toArray()
			return rows.length > 0
		})

		if (extended) {
			this.scheduleCleanupIfNeeded()
		}

		return extended
	}

	cacheGet(key: string) {
		const now = Date.now()
		const row = readCacheRow(
			this.sql.exec("SELECT value, expires_at FROM cache WHERE key = ? LIMIT 1", key).toArray()[0],
		)
		if (!row) return null
		if (row.expires_at !== null && row.expires_at <= now) {
			this.sql.exec("DELETE FROM cache WHERE key = ?", key)
			return null
		}
		return row.value
	}

	cacheSet(key: string, value: string, ttlMs?: number) {
		const expiresAt = ttlMs ? Date.now() + ttlMs : null
		this.sql.exec(
			"INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
			key,
			value,
			expiresAt,
		)
		if (expiresAt !== null) {
			this.scheduleCleanupIfNeeded()
		}
	}

	cacheSetIfNotExists(key: string, value: string, ttlMs?: number) {
		const result = this.ctx.storage.transactionSync(() => {
			const now = Date.now()
			const existingExpiresAt = readNullableExpiry(
				this.sql.exec("SELECT expires_at FROM cache WHERE key = ? LIMIT 1", key).toArray()[0],
			)
			if (
				existingExpiresAt !== undefined &&
				(existingExpiresAt === null || existingExpiresAt > now)
			) {
				return false
			}
			if (existingExpiresAt !== undefined) {
				this.sql.exec("DELETE FROM cache WHERE key = ?", key)
			}

			const expiresAt = ttlMs ? now + ttlMs : null
			this.sql.exec(
				"INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
				key,
				value,
				expiresAt,
			)
			return true
		})

		if (result && ttlMs) {
			this.scheduleCleanupIfNeeded()
		}

		return result
	}

	cacheDelete(key: string) {
		this.sql.exec("DELETE FROM cache WHERE key = ?", key)
	}

	listAppend(key: string, value: string, options?: { maxLength?: number; ttlMs?: number }) {
		let shouldScheduleCleanup = false
		this.ctx.storage.transactionSync(() => {
			const now = Date.now()
			const expiresAt = options?.ttlMs ? now + options.ttlMs : null
			const row = readCacheRow(
				this.sql
					.exec("SELECT value, expires_at FROM cache WHERE key = ? LIMIT 1", key)
					.toArray()[0],
			)
			let list: string[] =
				row && (row.expires_at === null || row.expires_at > now) ? parseStringList(row.value) : []

			list.push(value)
			if (options?.maxLength != null && list.length > options.maxLength) {
				list = list.slice(list.length - options.maxLength)
			}

			this.sql.exec(
				"INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
				key,
				JSON.stringify(list),
				expiresAt,
			)
			if (expiresAt !== null) {
				shouldScheduleCleanup = true
			}
		})

		if (shouldScheduleCleanup) {
			this.scheduleCleanupIfNeeded()
		}
	}

	listGet(key: string) {
		const raw = this.cacheGet(key)
		if (raw === null) return []
		return parseStringList(raw)
	}

	async alarm(): Promise<void> {
		try {
			const now = Date.now()
			this.ctx.storage.transactionSync(() => {
				this.sql.exec("DELETE FROM locks WHERE expires_at <= ?", now)
				this.sql.exec("DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at <= ?", now)
			})
			const next = this.nextExpiry()
			if (next !== null) {
				await this.ctx.storage.setAlarm(next)
			}
		} catch (err) {
			console.error("ChatStateDO alarm failed, rescheduling:", err)
			await this.ctx.storage.setAlarm(Date.now() + 30_000)
		}
	}

	private nextExpiry() {
		const now = Date.now()
		return readNextExpiry(
			this.sql
				.exec(
					`SELECT MIN(expires_at) as next_expiry FROM (
						SELECT expires_at FROM locks WHERE expires_at > ?
						UNION ALL
						SELECT expires_at FROM cache WHERE expires_at IS NOT NULL AND expires_at > ?
					)`,
					now,
					now,
				)
				.toArray()[0],
		)
	}

	private scheduleCleanupIfNeeded() {
		const next = this.nextExpiry()
		if (next !== null) {
			this.ctx.storage.setAlarm(next).catch((err) => {
				console.error("ChatStateDO failed to schedule cleanup alarm:", err)
			})
		}
	}
}
