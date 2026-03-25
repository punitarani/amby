import { Data } from "effect"

export class CoreError extends Data.TaggedError("CoreError")<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class AgentError extends Data.TaggedError("AgentError")<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class DbError extends Data.TaggedError("DbError")<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class PluginError extends Data.TaggedError("PluginError")<{
	readonly pluginId: string
	readonly message: string
	readonly cause?: unknown
}> {}

export class ChannelError extends Data.TaggedError("ChannelError")<{
	readonly message: string
	readonly cause?: unknown
}> {}
