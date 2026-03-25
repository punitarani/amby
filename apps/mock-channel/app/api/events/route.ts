import { getEmitter } from "../../../lib/sse-emitter"

export const dynamic = "force-dynamic"

export async function GET() {
	const emitter = getEmitter()

	let unsubscribe: (() => void) | undefined

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder()

			const send = (event: string, data: string) => {
				try {
					controller.enqueue(
						encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
					)
				} catch {
					unsubscribe?.()
				}
			}

			send("ping", JSON.stringify({ time: Date.now() }))

			unsubscribe = emitter.subscribe(send)
		},
		cancel() {
			unsubscribe?.()
		},
	})

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	})
}
