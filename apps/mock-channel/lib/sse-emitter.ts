export type SSECallback = (event: string, data: string) => void

export interface SSEEmitter {
	subscribe(callback: SSECallback): () => void
	broadcast(event: string, data: unknown): void
}

function createEmitter(): SSEEmitter {
	const listeners = new Set<SSECallback>()

	return {
		subscribe(callback: SSECallback): () => void {
			listeners.add(callback)
			return () => listeners.delete(callback)
		},
		broadcast(event: string, data: unknown): void {
			const json = JSON.stringify(data)
			for (const listener of listeners) {
				try {
					listener(event, json)
				} catch {
					// Remove dead listeners
					listeners.delete(listener)
				}
			}
		},
	}
}

// Persist across HMR
const globalEmitter = globalThis as unknown as { __mockChannelEmitter?: SSEEmitter }

export function getEmitter(): SSEEmitter {
	if (!globalEmitter.__mockChannelEmitter) {
		globalEmitter.__mockChannelEmitter = createEmitter()
	}
	return globalEmitter.__mockChannelEmitter
}
