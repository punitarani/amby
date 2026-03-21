import { describe, expect, it } from "bun:test"
import { HIGH_INTELLIGENCE_MODEL_ID } from "@amby/models"
import { tool } from "ai"
import { z } from "zod"
import { SUBAGENT_DEFS } from "./definitions"
import { buildToolGroups, resolveTools } from "./tool-groups"

const makeTool = () =>
	tool({
		description: "test tool",
		inputSchema: z.object({}),
		execute: async () => ({ ok: true }),
	})

describe("subagent configuration", () => {
	it("uses the high-intelligence model for reasoning-heavy subagents", () => {
		const byName = Object.fromEntries(SUBAGENT_DEFS.map((def) => [def.name, def]))

		expect(byName.research?.modelId).toBe(HIGH_INTELLIGENCE_MODEL_ID)
		expect(byName.planner?.modelId).toBe(HIGH_INTELLIGENCE_MODEL_ID)
		expect(byName.integration?.modelId).toBe(HIGH_INTELLIGENCE_MODEL_ID)
		expect(byName.integration?.toolKeys).toEqual(["integration"])
	})

	it("registers integration tools as a dedicated tool group", () => {
		const search_memories = makeTool()
		const save_memory = makeTool()
		const execute_command = makeTool()
		const read_file = makeTool()
		const write_file = makeTool()
		const list_integrations = makeTool()
		const gmail_fetch = makeTool()

		const groups = buildToolGroups(
			{ search_memories, save_memory } as never,
			{ execute_command, read_file, write_file } as never,
			undefined,
			{ list_integrations, gmail_fetch } as never,
		)

		expect(resolveTools(["integration"], groups)).toEqual({ list_integrations, gmail_fetch })
		expect(resolveTools(["memory-read", "integration"], groups)).toEqual({
			search_memories,
			list_integrations,
			gmail_fetch,
		})
	})
})
