import * as ai from "ai"
import { flush, initLogger, traced, wrapAISDK } from "braintrust"

const instrumentedAI = wrapAISDK(ai)

export const { generateText, streamText } = instrumentedAI
export const { stepCountIs, tool } = ai

export const initializeBraintrust = (apiKey?: string, projectName = "Amby Agent") => {
	const key = apiKey?.trim()
	if (!key) {
		console.warn("[braintrust] BRAINTRUST_API_KEY not set — tracing disabled")
		return
	}
	initLogger({ apiKey: key, projectName })
}

export const traceBraintrustOperation = async <T>(
	name: string,
	input: unknown,
	metadata: Record<string, unknown>,
	operation: () => Promise<T>,
	extractOutput: (result: T) => unknown = (result) => result,
) =>
	traced(
		async (span) => {
			try {
				const result = await operation()
				span.log({ input, output: extractOutput(result), metadata })
				return result
			} catch (error) {
				span.log({
					input,
					metadata,
					error: error instanceof Error ? error.message : String(error),
				})
				throw error
			}
		},
		{ name, type: "function" },
	)

export const flushBraintrust = () => flush()
