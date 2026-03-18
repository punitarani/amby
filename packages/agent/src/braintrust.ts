import * as ai from "ai"
import { flush, initLogger, traced, wrapAISDK } from "braintrust"

const instrumentedAI = wrapAISDK(ai)
const DEFAULT_BRAINTRUST_PROJECT_NAME = "Amby Agent"

let initializedConfig: { apiKey: string; projectName: string } | undefined

export const { generateText, streamText, Experimental_Agent, ToolLoopAgent } = instrumentedAI
export const { stepCountIs, tool } = ai

export const initializeBraintrust = (apiKey?: string, projectName?: string) => {
	const normalizedApiKey = apiKey?.trim()
	if (!normalizedApiKey) return false

	const resolvedProjectName = projectName?.trim() || DEFAULT_BRAINTRUST_PROJECT_NAME

	if (
		initializedConfig?.apiKey === normalizedApiKey &&
		initializedConfig?.projectName === resolvedProjectName
	) {
		return true
	}

	initLogger({
		apiKey: normalizedApiKey,
		projectName: resolvedProjectName,
	})

	initializedConfig = {
		apiKey: normalizedApiKey,
		projectName: resolvedProjectName,
	}

	return true
}

export const traceBraintrustOperation = async <T>(
	name: string,
	input: unknown,
	metadata: Record<string, unknown>,
	operation: () => Promise<T>,
	output: (result: T) => unknown = (result) => result,
) =>
	traced(
		async (span) => {
			const result = await operation()
			span.log({
				input,
				output: output(result),
				metadata,
			})
			return result
		},
		{ name, type: "function" },
	)

export const flushBraintrust = () => flush()
