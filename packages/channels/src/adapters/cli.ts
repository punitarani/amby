import { createInterface, type Interface } from "node:readline"
import { Effect } from "effect"
import { ChannelError } from "../errors"
import type { Channel, MessageHandler, OutgoingMessage } from "../types"

export class CLIChannel implements Channel {
	id = "cli-default"
	type = "cli" as const
	private handler: MessageHandler | null = null
	private rl: Interface | null = null
	private running = false

	onMessage(handler: MessageHandler): void {
		this.handler = handler
	}

	send(message: OutgoingMessage): Effect.Effect<void, ChannelError> {
		return Effect.sync(() => {
			console.log(`\n${message.content}\n`)
		})
	}

	start(): Effect.Effect<void, ChannelError> {
		const handler = this.handler
		if (!handler) return Effect.fail(new ChannelError({ message: "No message handler registered" }))

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

					try {
						const response = await handler({
							conversationId: "cli-session",
							content: trimmed,
							channelType: "cli",
						})
						console.log(`\n${response}\n`)
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
