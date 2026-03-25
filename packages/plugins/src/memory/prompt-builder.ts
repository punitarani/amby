import type { MemoryItem } from "@amby/core"

export interface DeduplicatedMemories {
	static: string[]
	dynamic: string[]
	search: string[]
}

export interface MemoryPromptData {
	profile: string
	search: string
}

export type PromptTemplate = (data: MemoryPromptData) => string

export function deduplicateMemories(
	staticItems: MemoryItem[],
	dynamicItems: MemoryItem[],
	searchItems: string[] = [],
): DeduplicatedMemories {
	const seen = new Set<string>()
	const result: DeduplicatedMemories = { static: [], dynamic: [], search: [] }

	for (const item of staticItems) {
		const key = item.content.trim()
		if (key && !seen.has(key)) {
			result.static.push(key)
			seen.add(key)
		}
	}
	for (const item of dynamicItems) {
		const key = item.content.trim()
		if (key && !seen.has(key)) {
			result.dynamic.push(key)
			seen.add(key)
		}
	}
	for (const item of searchItems) {
		const key = item.trim()
		if (key && !seen.has(key)) {
			result.search.push(key)
			seen.add(key)
		}
	}

	return result
}

const defaultTemplate: PromptTemplate = (data) => {
	const parts: string[] = []
	if (data.profile) parts.push(data.profile)
	if (data.search) parts.push(data.search)
	return parts.join("\n\n")
}

export function formatProfile(deduped: DeduplicatedMemories): string {
	const sections: string[] = []
	if (deduped.static.length) {
		sections.push("## Known Facts")
		sections.push(deduped.static.map((m) => `- ${m}`).join("\n"))
	}
	if (deduped.dynamic.length) {
		sections.push("## Recent Context")
		sections.push(deduped.dynamic.map((m) => `- ${m}`).join("\n"))
	}
	return sections.join("\n\n")
}

export function buildMemoriesText(
	deduped: DeduplicatedMemories,
	template: PromptTemplate = defaultTemplate,
): string {
	const profile = formatProfile(deduped)
	const search = deduped.search.length
		? `## Relevant Memories\n${deduped.search.map((m) => `- ${m}`).join("\n")}`
		: ""
	return template({ profile, search })
}
