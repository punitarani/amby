/** Per-turn cache to avoid repeated memory lookups within a single agent step loop. */
export class MemoryCache<T = string> {
	private store = new Map<string, T>()

	static makeKey(userId: string, query: string): string {
		return `${userId}:${query.trim().replace(/\s+/g, " ")}`
	}

	get(key: string): T | undefined {
		return this.store.get(key)
	}

	set(key: string, value: T): void {
		this.store.set(key, value)
	}

	has(key: string): boolean {
		return this.store.has(key)
	}

	clear(): void {
		this.store.clear()
	}
}
