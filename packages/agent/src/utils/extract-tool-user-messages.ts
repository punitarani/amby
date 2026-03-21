/**
 * Collect user-facing messages from all tool results in a step, deduplicated.
 *
 * Iterates all results (not just the last) because connector tools may appear
 * at any position. Only codex-auth and connector tools emit userMessages, and
 * Set-based dedup prevents repeats.
 */
export const extractToolUserMessages = (
	toolResults: ReadonlyArray<{ output?: unknown } | undefined>,
): string[] | undefined => {
	const messages: string[] = []
	const seen = new Set<string>()

	for (const toolResult of toolResults) {
		const output = toolResult?.output
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
