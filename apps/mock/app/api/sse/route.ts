import { addSSEListener } from "../../../lib/sse-emitter"

export async function GET(request: Request) {
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder()

			const remove = addSSEListener((data: string) => {
				controller.enqueue(encoder.encode(`data: ${data}\n\n`))
			})

			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(": heartbeat\n\n"))
				} catch {
					clearInterval(heartbeat)
					remove()
				}
			}, 30_000)

			// Clean up when client disconnects
			request.signal.addEventListener("abort", () => {
				clearInterval(heartbeat)
				remove()
			})
		},
	})

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	})
}
