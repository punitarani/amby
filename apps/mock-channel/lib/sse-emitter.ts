type Listener = (event: string, data: string) => void

interface SseEmitter {
	subscribe: (listener: Listener) => () => void
	broadcast: (event: string, data: unknown) => void
}

let emitter: SseEmitter | null = null

function createEmitter(): SseEmitter {
	const listeners = new Set<Listener>()

	return {
		subscribe(listener: Listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		broadcast(event: string, data: unknown) {
			const payload = JSON.stringify(data)
			for (const listener of listeners) {
				listener(event, payload)
			}
		},
	}
}

export function getEmitter(): SseEmitter {
	if (!emitter) {
		emitter = createEmitter()
	}
	return emitter
}
