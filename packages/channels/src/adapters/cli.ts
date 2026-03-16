import { createInterface, type Interface } from "node:readline"
import { Effect } from "effect"
import { ChannelError } from "../errors"
import type { Channel, MessageHandler, OutgoingMessage, StreamingMessageHandler } from "../types"

export class CLIChannel implements Channel {
	id = "cli-default"
	type = "cli" as const
	private handler: MessageHandler | null = null
	private streamingHandler: StreamingMessageHandler | null = null
	private rl: Interface | null = null
	private running = false

	onMessage(handler: MessageHandler): void {
		this.handler = handler
	}

	onStreamingMessage(handler: StreamingMessageHandler): void {
		this.streamingHandler = handler
	}

	send(message: OutgoingMessage): Effect.Effect<void, ChannelError> {
		return Effect.sync(() => {
			console.log(`\n${message.content}\n`)
		})
	}

	start(): Effect.Effect<void, ChannelError> {
		const handler = this.handler
		if (!handler) return Effect.fail(new ChannelError({ message: "No message handler registered" }))

		const streamingHandler = this.streamingHandler

		return Effect.async<void, ChannelError>((resume) => {
			this.running = true

			this.rl = createInterface({
				input: process.stdin,
				output: process.stdout,
			})

			const prompt = () => {
				if (!this.running) {
					resume(Effect.void)
					return
				}
				this.rl?.question("> ", async (input) => {
					const trimmed = input.trim()
					if (!trimmed) return prompt()
					if (trimmed === "/quit" || trimmed === "/exit") {
						this.running = false
						this.rl?.close()
						resume(Effect.void)
						return
					}

					const msg = {
						conversationId: "cli-session",
						content: trimmed,
						channelType: "cli" as const,
					}

					try {
						if (streamingHandler) {
							process.stdout.write("\n")
							await streamingHandler(msg, (part) => {
								switch (part.type) {
									case "text-delta":
										process.stdout.write(part.text as string)
										break
									case "tool-call":
										process.stdout.write(`\n\x1b[2m[${part.toolName}]\x1b[0m `)
										break
									case "tool-result":
										process.stdout.write("\n")
										break
								}
							})
							process.stdout.write("\n\n")
						} else {
							const response = await handler(msg)
							console.log(`\n${response}\n`)
						}
					} catch (err) {
						console.error("Error:", err)
					}
					prompt()
				})
			}

			prompt()
		})
	}

	stop(): Effect.Effect<void, ChannelError> {
		return Effect.sync(() => {
			this.running = false
			this.rl?.close()
		})
	}
}
