/**
 * Simple SSE (Server-Sent Events) emitter for pushing updates to the UI.
 * Server-side only.
 */

type Listener = (data: string) => void

const listeners = new Set<Listener>()

export function addSSEListener(listener: Listener): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export function emitSSE(event: string, data: unknown): void {
	const payload = JSON.stringify({ event, data })
	for (const listener of listeners) {
		listener(payload)
	}
}
