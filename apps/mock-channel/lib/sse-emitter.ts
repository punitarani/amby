type Listener = (event: string, data: unknown) => void

interface Emitter {
	subscribe: (listener: Listener) => () => void
	broadcast: (event: string, data: unknown) => void
}

declare const globalThis: {
	__mockChannelEmitter?: Emitter
}

function createEmitter(): Emitter {
	const listeners = new Set<Listener>()

	return {
		subscribe(listener: Listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		broadcast(event: string, data: unknown) {
			for (const listener of listeners) {
				listener(event, data)
			}
		},
	}
}

export function getEmitter(): Emitter {
	if (!globalThis.__mockChannelEmitter) {
		globalThis.__mockChannelEmitter = createEmitter()
	}
	return globalThis.__mockChannelEmitter
}
