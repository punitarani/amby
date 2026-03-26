import { Data } from "effect"

export class ConnectorsError extends Data.TaggedError("ConnectorsError")<{
	readonly message: string
	readonly cause?: unknown
}> {}
