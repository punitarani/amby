import { Effect } from "effect"
import { ChannelError } from "./errors"
import type { Channel, ChannelType, OutgoingMessage } from "./types"

export class ChannelRegistry {
	private channels = new Map<string, Channel>()

	register(channel: Channel): void {
		this.channels.set(channel.id, channel)
	}

	get(id: string): Channel | undefined {
		return this.channels.get(id)
	}

	getByType(type: ChannelType): Channel | undefined {
		for (const ch of this.channels.values()) {
			if (ch.type === type) return ch
		}
		return undefined
	}

	send(channelId: string, message: OutgoingMessage): Effect.Effect<void, ChannelError> {
		const channel = this.channels.get(channelId)
		if (!channel)
			return Effect.fail(new ChannelError({ message: `Channel ${channelId} not found` }))
		return channel.send(message)
	}

	startAll(): Effect.Effect<void, ChannelError> {
		return Effect.forEach([...this.channels.values()], (ch) => ch.start(), { discard: true })
	}

	stopAll(): Effect.Effect<void, ChannelError> {
		return Effect.forEach([...this.channels.values()], (ch) => ch.stop(), { discard: true })
	}
}
