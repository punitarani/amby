import { Context, Data, type Effect } from "effect"

export interface BrowserTaskInput {
	task: string
	startUrl?: string
}

export interface BrowserTaskResult {
	success: boolean
	summary: string
	finalUrl: string | null
	title: string | null
}

export class BrowserError extends Data.TaggedError("BrowserError")<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class BrowserService extends Context.Tag("BrowserService")<
	BrowserService,
	{
		readonly enabled: boolean
		readonly runTask: (input: BrowserTaskInput) => Effect.Effect<BrowserTaskResult, BrowserError>
	}
>() {}
