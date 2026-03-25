import { describe, expect, it } from "bun:test"
import type { SpecialistKind } from "@amby/db"
import { makeAgentRunConfig } from "../test-helpers/factories"
import type { ToolGroups } from "./registry"
import { getSpecialistDefinition, resolveVisibleTools, SPECIALIST_REGISTRY } from "./registry"

const ALL_SPECIALISTS: SpecialistKind[] = [
	"conversation",
	"planner",
	"research",
	"builder",
	"integration",
	"computer",
	"browser",
	"memory",
	"settings",
	"validator",
]

describe("SPECIALIST_REGISTRY", () => {
	it("contains all 10 specialist definitions", () => {
		expect(Object.keys(SPECIALIST_REGISTRY).sort()).toEqual([...ALL_SPECIALISTS].sort())
	})

	it.each(ALL_SPECIALISTS)("%s has a valid definition", (kind) => {
		const def = SPECIALIST_REGISTRY[kind]
		expect(def.kind).toBe(kind)
		expect(typeof def.runnerKind).toBe("string")
		expect(typeof def.selectModel).toBe("function")
		expect(Array.isArray(def.toolGroups)).toBe(true)
		expect(typeof def.maxSteps).toBe("function")
		expect(typeof def.buildPrompt).toBe("function")
	})

	describe("runner kinds", () => {
		it("browser uses browser_service runner", () => {
			expect(SPECIALIST_REGISTRY.browser.runnerKind).toBe("browser_service")
		})

		it("conversation, planner, research, builder, integration, computer, memory, settings, validator use toolloop", () => {
			const toolloopSpecialists: SpecialistKind[] = [
				"conversation",
				"planner",
				"research",
				"builder",
				"integration",
				"computer",
				"memory",
				"settings",
				"validator",
			]
			for (const kind of toolloopSpecialists) {
				expect(SPECIALIST_REGISTRY[kind].runnerKind).toBe("toolloop")
			}
		})
	})

	describe("tool groups", () => {
		it("research has memory-read and sandbox-read", () => {
			expect(SPECIALIST_REGISTRY.research.toolGroups).toContain("memory-read")
			expect(SPECIALIST_REGISTRY.research.toolGroups).toContain("sandbox-read")
		})

		it("builder has memory-read, sandbox-read, sandbox-write", () => {
			expect(SPECIALIST_REGISTRY.builder.toolGroups).toContain("memory-read")
			expect(SPECIALIST_REGISTRY.builder.toolGroups).toContain("sandbox-read")
			expect(SPECIALIST_REGISTRY.builder.toolGroups).toContain("sandbox-write")
		})

		it("integration has integration group", () => {
			expect(SPECIALIST_REGISTRY.integration.toolGroups).toContain("integration")
		})

		it("computer has cua group", () => {
			expect(SPECIALIST_REGISTRY.computer.toolGroups).toContain("cua")
		})

		it("memory has memory-read and memory-write", () => {
			expect(SPECIALIST_REGISTRY.memory.toolGroups).toContain("memory-read")
			expect(SPECIALIST_REGISTRY.memory.toolGroups).toContain("memory-write")
		})

		it("settings has settings group", () => {
			expect(SPECIALIST_REGISTRY.settings.toolGroups).toContain("settings")
		})

		it("conversation has no tool groups", () => {
			expect(SPECIALIST_REGISTRY.conversation.toolGroups).toHaveLength(0)
		})

		it("validator has no tool groups", () => {
			expect(SPECIALIST_REGISTRY.validator.toolGroups).toHaveLength(0)
		})

		it("browser has no tool groups (browser_service handles tools)", () => {
			expect(SPECIALIST_REGISTRY.browser.toolGroups).toHaveLength(0)
		})
	})
})

describe("getSpecialistDefinition", () => {
	it("returns the correct definition for each kind", () => {
		for (const kind of ALL_SPECIALISTS) {
			expect(getSpecialistDefinition(kind).kind).toBe(kind)
		}
	})
})

describe("resolveVisibleTools", () => {
	const mockTools: ToolGroups = {
		"memory-read": { search_memories: {} as never },
		"memory-write": { save_memory: {} as never },
		"sandbox-read": { read_file: {} as never },
		"sandbox-write": { write_file: {} as never },
		integration: { gmail_send: {} as never },
		cua: { computer_use: {} as never },
		settings: { set_timezone: {} as never },
	}

	it("returns tools matching specialist's tool groups", () => {
		const def = getSpecialistDefinition("research")
		const config = makeAgentRunConfig()
		const tools = resolveVisibleTools(def, config, mockTools)
		expect(tools).toHaveProperty("search_memories")
		expect(tools).toHaveProperty("read_file")
		expect(tools).not.toHaveProperty("write_file")
		expect(tools).not.toHaveProperty("gmail_send")
	})

	it("filters integration tools when integration is disabled", () => {
		const def = getSpecialistDefinition("integration")
		const config = makeAgentRunConfig({
			runtime: {
				sandboxEnabled: true,
				cuaEnabled: false,
				integrationEnabled: false,
				streamingEnabled: false,
				browserEnabled: true,
			},
		})
		const tools = resolveVisibleTools(def, config, mockTools)
		expect(tools).not.toHaveProperty("gmail_send")
	})

	it("includes integration tools when integration is enabled", () => {
		const def = getSpecialistDefinition("integration")
		const config = makeAgentRunConfig({
			runtime: {
				sandboxEnabled: true,
				cuaEnabled: false,
				integrationEnabled: true,
				streamingEnabled: false,
				browserEnabled: true,
			},
		})
		const tools = resolveVisibleTools(def, config, mockTools)
		expect(tools).toHaveProperty("gmail_send")
	})

	it("filters CUA tools when CUA is disabled", () => {
		const def = getSpecialistDefinition("computer")
		const config = makeAgentRunConfig({
			runtime: {
				sandboxEnabled: true,
				cuaEnabled: false,
				integrationEnabled: false,
				streamingEnabled: false,
				browserEnabled: true,
			},
		})
		const tools = resolveVisibleTools(def, config, mockTools)
		expect(tools).not.toHaveProperty("computer_use")
	})

	it("includes CUA tools when CUA is enabled", () => {
		const def = getSpecialistDefinition("computer")
		const config = makeAgentRunConfig({
			runtime: {
				sandboxEnabled: true,
				cuaEnabled: true,
				integrationEnabled: false,
				streamingEnabled: false,
				browserEnabled: true,
			},
		})
		const tools = resolveVisibleTools(def, config, mockTools)
		expect(tools).toHaveProperty("computer_use")
	})

	it("filters sandbox tools when sandbox is disabled", () => {
		const def = getSpecialistDefinition("builder")
		const config = makeAgentRunConfig({
			runtime: {
				sandboxEnabled: false,
				cuaEnabled: false,
				integrationEnabled: false,
				streamingEnabled: false,
				browserEnabled: true,
			},
		})
		const tools = resolveVisibleTools(def, config, mockTools)
		expect(tools).not.toHaveProperty("read_file")
		expect(tools).not.toHaveProperty("write_file")
		// memory-read should still be present
		expect(tools).toHaveProperty("search_memories")
	})

	it("respects allowedToolGroups whitelist", () => {
		const def = getSpecialistDefinition("builder")
		const config = makeAgentRunConfig({
			policy: {
				allowedToolGroups: ["memory-read"],
				allowDirectAnswer: true,
				allowBackgroundTasks: true,
				allowMemoryWrites: true,
				allowExternalWrites: true,
				requireWriteConfirmation: true,
				maxDepth: 1,
			},
		})
		const tools = resolveVisibleTools(def, config, mockTools)
		expect(tools).toHaveProperty("search_memories")
		expect(tools).not.toHaveProperty("read_file")
		expect(tools).not.toHaveProperty("write_file")
	})

	it("returns empty tools for specialists with no tool groups", () => {
		const def = getSpecialistDefinition("conversation")
		const config = makeAgentRunConfig()
		const tools = resolveVisibleTools(def, config, mockTools)
		expect(Object.keys(tools)).toHaveLength(0)
	})
})
