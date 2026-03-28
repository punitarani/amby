import { describe, expect, it } from "bun:test"
import {
	type ChatStateNamespaceLike,
	type ChatStateStub,
	createCloudflareChatState,
} from "./cloudflare-chat-state"

function makeFakeNamespace() {
	let now = 1_000
	const subscriptions = new Set<string>()
	const locks = new Map<string, { expiresAt: number; token: string }>()
	const cache = new Map<string, { expiresAt: number | null; value: string }>()

	const readCache = (key: string) => {
		const row = cache.get(key)
		if (!row) return null
		if (row.expiresAt !== null && row.expiresAt <= now) {
			cache.delete(key)
			return null
		}
		return row
	}

	const stub: ChatStateStub = {
		subscribe(threadId) {
			subscriptions.add(threadId)
		},
		unsubscribe(threadId) {
			subscriptions.delete(threadId)
		},
		isSubscribed(threadId) {
			return subscriptions.has(threadId)
		},
		acquireLock(threadId, ttlMs) {
			const row = locks.get(threadId)
			if (row && row.expiresAt > now) return null
			const lock = { threadId, token: `lock-${now}`, expiresAt: now + ttlMs }
			locks.set(threadId, { token: lock.token, expiresAt: lock.expiresAt })
			return lock
		},
		forceReleaseLock(threadId) {
			locks.delete(threadId)
		},
		releaseLock(threadId, token) {
			const row = locks.get(threadId)
			if (row?.token === token) {
				locks.delete(threadId)
			}
		},
		extendLock(threadId, token, ttlMs) {
			const row = locks.get(threadId)
			if (!row || row.token !== token || row.expiresAt <= now) {
				locks.delete(threadId)
				return false
			}
			row.expiresAt = now + ttlMs
			return true
		},
		cacheGet(key) {
			return readCache(key)?.value ?? null
		},
		cacheSet(key, value, ttlMs) {
			cache.set(key, { value, expiresAt: ttlMs ? now + ttlMs : null })
		},
		cacheSetIfNotExists(key, value, ttlMs) {
			const row = readCache(key)
			if (row) return false
			cache.set(key, { value, expiresAt: ttlMs ? now + ttlMs : null })
			return true
		},
		cacheDelete(key) {
			cache.delete(key)
		},
		listAppend(key, value, options) {
			const row = readCache(key)
			let list: string[] = []
			if (row) {
				try {
					const parsed = JSON.parse(row.value)
					if (Array.isArray(parsed)) {
						list = parsed.filter((entry): entry is string => typeof entry === "string")
					}
				} catch {
					list = []
				}
			}
			list.push(value)
			if (options?.maxLength && list.length > options.maxLength) {
				list = list.slice(list.length - options.maxLength)
			}
			cache.set(key, {
				value: JSON.stringify(list),
				expiresAt: options?.ttlMs ? now + options.ttlMs : null,
			})
		},
		listGet(key) {
			const row = readCache(key)
			if (!row) return []
			try {
				const parsed = JSON.parse(row.value)
				return Array.isArray(parsed)
					? parsed.filter((entry): entry is string => typeof entry === "string")
					: []
			} catch {
				return []
			}
		},
	}

	const namespace: ChatStateNamespaceLike = {
		idFromName(name: string) {
			return { toString: () => name }
		},
		get() {
			return stub
		},
	}

	return {
		advanceBy(ms: number) {
			now += ms
		},
		namespace,
	}
}

describe("createCloudflareChatState", () => {
	it("tracks subscriptions through the adapter contract", async () => {
		const fake = makeFakeNamespace()
		const state = createCloudflareChatState({ namespace: fake.namespace })

		await state.connect()
		await state.subscribe("thread-1")
		expect(await state.isSubscribed("thread-1")).toBe(true)

		await state.unsubscribe("thread-1")
		expect(await state.isSubscribed("thread-1")).toBe(false)
	})

	it("implements lock acquire, extend, release, and force-release", async () => {
		const fake = makeFakeNamespace()
		const state = createCloudflareChatState({ namespace: fake.namespace })

		await state.connect()
		const lock = await state.acquireLock("thread-1", 100)
		expect(lock?.threadId).toBe("thread-1")
		expect(await state.acquireLock("thread-1", 100)).toBeNull()

		expect(lock && (await state.extendLock(lock, 200))).toBe(true)
		await state.forceReleaseLock("thread-1")
		expect(await state.acquireLock("thread-1", 100)).not.toBeNull()

		if (!lock) throw new Error("expected lock")
		await state.releaseLock(lock)
	})

	it("implements conditional set and expiry semantics", async () => {
		const fake = makeFakeNamespace()
		const state = createCloudflareChatState({ namespace: fake.namespace })

		await state.connect()
		expect(await state.setIfNotExists("dedupe:key", true, 50)).toBe(true)
		expect(await state.setIfNotExists("dedupe:key", true, 50)).toBe(false)
		expect(await state.get<boolean>("dedupe:key")).toBe(true)

		fake.advanceBy(60)
		expect(await state.get("dedupe:key")).toBeNull()
		expect(await state.setIfNotExists("dedupe:key", true, 50)).toBe(true)

		await state.delete("dedupe:key")
		expect(await state.get("dedupe:key")).toBeNull()
	})

	it("stores list values with trim and ttl behavior", async () => {
		const fake = makeFakeNamespace()
		const state = createCloudflareChatState({ namespace: fake.namespace })

		await state.connect()
		await state.appendToList("msg-history:thread-1", { id: 1 }, { maxLength: 2, ttlMs: 50 })
		await state.appendToList("msg-history:thread-1", { id: 2 }, { maxLength: 2, ttlMs: 50 })
		await state.appendToList("msg-history:thread-1", { id: 3 }, { maxLength: 2, ttlMs: 50 })

		expect(await state.getList<{ id: number }>("msg-history:thread-1")).toEqual([
			{ id: 2 },
			{ id: 3 },
		])

		fake.advanceBy(60)
		expect(await state.getList("msg-history:thread-1")).toEqual([])
	})
})
