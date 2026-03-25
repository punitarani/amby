export type MemoryCategory = "static" | "dynamic" | "inference"

export interface Memory {
	readonly id: string
	readonly userId: string
	readonly content: string
	readonly category: MemoryCategory
	readonly isActive: boolean
	readonly source?: string
	readonly metadata?: Record<string, unknown>
	readonly version: number
	readonly parentId?: string
	readonly createdAt: Date
	readonly updatedAt: Date
}

export interface MemorySearchResult {
	readonly id: string
	readonly content: string
	readonly category: MemoryCategory
	readonly similarity: number
}

export interface ProfileMemories {
	readonly static: MemoryItem[]
	readonly dynamic: MemoryItem[]
}

export interface MemoryItem {
	readonly id: string
	readonly content: string
	readonly category: MemoryCategory
	readonly metadata?: Record<string, unknown>
}
