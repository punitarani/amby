/**
 * Collect user-facing messages from tool results, deduplicated.
 *
 * Iterates all results because connector tools may appear at any position.
 * Only codex-auth / delegation / connector tools emit userMessages; Set-based dedup prevents repeats.
 */
export const extractToolUserMessages = (
	toolResults: ReadonlyArray<unknown> | undefined,
): string[] | undefined => {
	if (!toolResults?.length) return undefined

	const messages: string[] = []
	const seen = new Set<string>()

	for (const toolResult of toolResults) {
		const output = getToolResultOutput(toolResult)
		if (
			typeof output === "object" &&
			output !== null &&
			"userMessages" in output &&
			Array.isArray(output.userMessages) &&
			output.userMessages.every((message) => typeof message === "string" && message.trim())
		) {
			for (const message of output.userMessages) {
				if (seen.has(message)) continue
				seen.add(message)
				messages.push(message)
			}
		}
	}

	return messages.length > 0 ? messages : undefined
}

function getToolResultOutput(toolResult: unknown): unknown {
	if (typeof toolResult !== "object" || toolResult === null) return undefined
	const tr = toolResult as Record<string, unknown>
	return tr.output ?? tr.result
}

/**
 * ToolLoopAgent exposes `toolResults` for the **last step only**. If the model runs
 * `delegate_task` (with userMessages) and then a final text-only step, those messages
 * are only present on earlier `steps[].toolResults`. Flatten all steps so Codex/connector
 * prompts always reach the user.
 */
export function collectAllToolResultsForUserMessages(result: {
	toolResults?: ReadonlyArray<unknown>
	steps?: ReadonlyArray<{ toolResults?: ReadonlyArray<unknown> }>
}): ReadonlyArray<unknown> | undefined {
	if (result.steps && result.steps.length > 0) {
		const merged = result.steps.flatMap((s) => s.toolResults ?? [])
		return merged.length > 0 ? merged : undefined
	}
	return result.toolResults
}
