import type { createComputerTools, createCuaTools } from "@amby/computer"
import type { createMemoryTools } from "@amby/memory"
import type { ToolSet } from "ai"

export type ToolGroups = Record<string, ToolSet>

export function buildToolGroups(
	memoryTools: ReturnType<typeof createMemoryTools>,
	computerTools: ReturnType<typeof createComputerTools>["tools"],
	cuaTools?: ReturnType<typeof createCuaTools>["tools"],
): ToolGroups {
	const { execute_command, read_file, write_file } = computerTools

	const { search_memories, save_memory } = memoryTools

	const groups: ToolGroups = {
		"memory-read": { search_memories } as ToolSet,
		"memory-write": { save_memory } as ToolSet,
		"computer-read": { execute_command, read_file } as ToolSet,
		"computer-write": { write_file } as ToolSet,
	}

	if (cuaTools) {
		groups.cua = cuaTools as ToolSet
	}

	return groups
}

export function resolveTools(keys: string[], groups: ToolGroups): ToolSet {
	const tools: ToolSet = {}
	for (const key of keys) {
		const group = groups[key]
		if (group) {
			Object.assign(tools, group)
		}
	}
	return tools
}
