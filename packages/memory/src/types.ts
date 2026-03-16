export type MemoryCategory = "static" | "dynamic" | "inference"

export interface MemoryItem {
	id: string
	content: string
	category: MemoryCategory
	metadata?: Record<string, unknown>
}

export interface MemorySearchResult {
	id: string
	content: string
	category: MemoryCategory
	similarity: number
}

export interface ProfileMemories {
	static: MemoryItem[]
	dynamic: MemoryItem[]
}

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
