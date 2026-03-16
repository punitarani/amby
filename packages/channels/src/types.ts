import type { Effect } from "effect"
import type { ChannelError } from "./errors"

export type ChannelType = "cli" | "sms" | "imessage" | "web" | "mobile"

export interface IncomingMessage {
	conversationId: string
	content: string
	channelType: ChannelType
	metadata?: Record<string, unknown>
}

export interface OutgoingMessage {
	conversationId: string
	content: string
	metadata?: Record<string, unknown>
}

export type MessageHandler = (message: IncomingMessage) => Promise<string>

export type StreamingMessageHandler = (
	message: IncomingMessage,
	onPart: (part: { type: string; [key: string]: unknown }) => void,
) => Promise<string>

export interface Channel {
	id: string
	type: ChannelType
	onMessage(handler: MessageHandler): void
	onStreamingMessage?(handler: StreamingMessageHandler): void
	send(message: OutgoingMessage): Effect.Effect<void, ChannelError>
	start(): Effect.Effect<void, ChannelError>
	stop(): Effect.Effect<void, ChannelError>
}
