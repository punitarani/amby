interface ChatStateLock {
	expiresAt: number
	threadId: string
	token: string
}

export interface ChatStateStub {
	subscribe(threadId: string): Promise<void> | void
	unsubscribe(threadId: string): Promise<void> | void
	isSubscribed(threadId: string): Promise<boolean> | boolean
	acquireLock(threadId: string, ttlMs: number): Promise<ChatStateLock | null> | ChatStateLock | null
	forceReleaseLock(threadId: string): Promise<void> | void
	releaseLock(threadId: string, token: string): Promise<void> | void
	extendLock(threadId: string, token: string, ttlMs: number): Promise<boolean> | boolean
	cacheGet(key: string): Promise<string | null> | string | null
	cacheSet(key: string, value: string, ttlMs?: number): Promise<void> | void
	cacheSetIfNotExists(key: string, value: string, ttlMs?: number): Promise<boolean> | boolean
	cacheDelete(key: string): Promise<void> | void
	listAppend(
		key: string,
		value: string,
		options?: { maxLength?: number; ttlMs?: number },
	): Promise<void> | void
	listGet(key: string): Promise<string[]> | string[]
}

interface DurableObjectIdLike {
	toString(): string
}

export interface ChatStateNamespaceLike {
	idFromName(name: string): DurableObjectIdLike
	get(id: DurableObjectIdLike): ChatStateStub
}

export interface CloudflareChatStateOptions {
	name?: string
	namespace: ChatStateNamespaceLike
}

export class CloudflareChatStateAdapter {
	private readonly defaultName: string
	private readonly namespace: ChatStateNamespaceLike
	private connected = false

	constructor(options: CloudflareChatStateOptions) {
		this.namespace = options.namespace
		this.defaultName = options.name ?? "default"
	}

	private stub() {
		this.ensureConnected()
		const id = this.namespace.idFromName(this.defaultName)
		return this.namespace.get(id)
	}

	private ensureConnected() {
		if (!this.connected) {
			throw new Error("CloudflareChatStateAdapter is not connected. Call connect() first.")
		}
	}

	async connect() {
		this.connected = true
	}

	async disconnect() {
		this.connected = false
	}

	async subscribe(threadId: string) {
		await this.stub().subscribe(threadId)
	}

	async unsubscribe(threadId: string) {
		await this.stub().unsubscribe(threadId)
	}

	async isSubscribed(threadId: string) {
		return await this.stub().isSubscribed(threadId)
	}

	async acquireLock(threadId: string, ttlMs: number) {
		return await this.stub().acquireLock(threadId, ttlMs)
	}

	async forceReleaseLock(threadId: string) {
		await this.stub().forceReleaseLock(threadId)
	}

	async releaseLock(lock: ChatStateLock) {
		await this.stub().releaseLock(lock.threadId, lock.token)
	}

	async extendLock(lock: ChatStateLock, ttlMs: number) {
		return await this.stub().extendLock(lock.threadId, lock.token, ttlMs)
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		const raw = await this.stub().cacheGet(key)
		if (raw === null) return null
		try {
			return JSON.parse(raw) as T
		} catch {
			return raw as T
		}
	}

	async set<T = unknown>(key: string, value: T, ttlMs?: number) {
		await this.stub().cacheSet(key, JSON.stringify(value), ttlMs)
	}

	async setIfNotExists(key: string, value: unknown, ttlMs?: number) {
		return await this.stub().cacheSetIfNotExists(key, JSON.stringify(value), ttlMs)
	}

	async delete(key: string) {
		await this.stub().cacheDelete(key)
	}

	async appendToList(
		key: string,
		value: unknown,
		options?: { maxLength?: number; ttlMs?: number },
	) {
		await this.stub().listAppend(key, JSON.stringify(value), options)
	}

	async getList<T = unknown>(key: string): Promise<T[]> {
		const values = await this.stub().listGet(key)
		return values.map((value) => JSON.parse(value) as T)
	}
}

export function createCloudflareChatState(options: CloudflareChatStateOptions) {
	return new CloudflareChatStateAdapter(options)
}
