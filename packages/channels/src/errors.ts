import { Data } from "effect"

export class ChannelError extends Data.TaggedError("ChannelError")<{
	readonly message: string
	readonly cause?: unknown
}> {}
