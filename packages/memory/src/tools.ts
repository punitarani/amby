import { tool } from "ai"
import type { Context } from "effect"
import { Effect } from "effect"
import { z } from "zod"
import type { MemoryService } from "./repository"

type MemoryOps = Context.Tag.Service<typeof MemoryService>

export function createMemoryTools(memory: MemoryOps, userId: string) {
	return {
		save_memory: tool({
			description:
				"Save an important fact, preference, or context about the user for future reference. Use 'static' for permanent facts (name, preferences), 'dynamic' for temporary context (current projects, recent events).",
			inputSchema: z.object({
				content: z.string().describe("The memory to save"),
				category: z
					.enum(["static", "dynamic"])
					.default("dynamic")
					.describe("static = permanent facts, dynamic = temporary context"),
			}),
			execute: async ({ content, category }) => {
				const id = await Effect.runPromise(memory.add(userId, content, category))
				return { saved: true, id }
			},
		}),

		search_memories: tool({
			description: "Search your memories about the user to recall relevant context.",
			inputSchema: z.object({
				query: z.string().describe("What to search for in memories"),
			}),
			execute: async ({ query }) => {
				const profile = await Effect.runPromise(memory.getProfile(userId))
				const all = [...profile.static, ...profile.dynamic]
				const queryLower = query.toLowerCase()
				const relevant = all.filter((m) => m.content.toLowerCase().includes(queryLower))
				return relevant.length > 0
					? relevant.map((m) => ({ content: m.content, category: m.category }))
					: all.slice(0, 10).map((m) => ({ content: m.content, category: m.category }))
			},
		}),
	}
}
