import type { RunnerKind, SpecialistKind } from "@amby/db"
import type { FlexibleSchema, ToolSet } from "ai"
import { HIGH_INTELLIGENCE_MODEL_ID } from "../models"
import { buildSpecialistPrompt } from "../specialists/prompts"
import {
	browserTaskInputSchema,
	executionPlanSchema,
	settingsTaskInputSchema,
	specialistResultSchema,
	specialistTaskInputSchema,
	validatorResultSchema,
} from "../specialists/schemas"
import type { AgentRunConfig } from "../types/agent"
import type { ToolGroupKey } from "../types/execution"

export type SpecialistDefinition = {
	kind: SpecialistKind
	runnerKind: RunnerKind
	selectModel: (config: AgentRunConfig) => string | undefined
	toolGroups: ToolGroupKey[]
	maxSteps: (config: AgentRunConfig) => number
	buildPrompt: (config: AgentRunConfig) => string
	inputSchema: FlexibleSchema<unknown>
	resultSchema: FlexibleSchema<unknown>
}

export type ToolGroups = Partial<Record<ToolGroupKey, ToolSet>>

const defaultModel = (config: AgentRunConfig) => config.modelPolicy.defaultModelId
const highReasoningModel = (config: AgentRunConfig) =>
	config.modelPolicy.highReasoningModelId ?? HIGH_INTELLIGENCE_MODEL_ID

const getBudget = (kind: SpecialistKind, fallback: number) => (config: AgentRunConfig) =>
	config.budgets.maxSubagentStepsByKind[kind] ?? fallback

function specialist(
	kind: SpecialistKind,
	runnerKind: RunnerKind,
	toolGroups: ToolGroupKey[],
	options: {
		model: (config: AgentRunConfig) => string | undefined
		maxSteps: (config: AgentRunConfig) => number
		inputSchema?: FlexibleSchema<unknown>
		resultSchema?: FlexibleSchema<unknown>
	},
): SpecialistDefinition {
	return {
		kind,
		runnerKind,
		selectModel: options.model,
		toolGroups,
		maxSteps: options.maxSteps,
		buildPrompt: (config) => buildSpecialistPrompt(kind, config.context.sharedPromptContext),
		inputSchema: options.inputSchema ?? specialistTaskInputSchema,
		resultSchema: options.resultSchema ?? specialistResultSchema,
	}
}

export const SPECIALIST_REGISTRY: Record<SpecialistKind, SpecialistDefinition> = {
	conversation: specialist("conversation", "toolloop", [], {
		model: defaultModel,
		maxSteps: getBudget("conversation", 8),
	}),
	planner: specialist("planner", "toolloop", [], {
		model: highReasoningModel,
		maxSteps: getBudget("planner", 3),
		resultSchema: executionPlanSchema,
	}),
	research: specialist("research", "toolloop", ["memory-read", "sandbox-read"], {
		model: highReasoningModel,
		maxSteps: getBudget("research", 8),
	}),
	builder: specialist("builder", "toolloop", ["memory-read", "sandbox-read", "sandbox-write"], {
		model: defaultModel,
		maxSteps: getBudget("builder", 10),
	}),
	integration: specialist("integration", "toolloop", ["integration"], {
		model: highReasoningModel,
		maxSteps: getBudget("integration", 10),
	}),
	computer: specialist("computer", "toolloop", ["cua"], {
		model: defaultModel,
		maxSteps: getBudget("computer", 16),
	}),
	browser: specialist("browser", "browser_service", [], {
		model: defaultModel,
		maxSteps: getBudget("browser", 24),
		inputSchema: browserTaskInputSchema,
		resultSchema: specialistResultSchema,
	}),
	memory: specialist("memory", "toolloop", ["memory-read", "memory-write"], {
		model: defaultModel,
		maxSteps: getBudget("memory", 5),
	}),
	settings: specialist("settings", "toolloop", ["settings", "automation"], {
		model: defaultModel,
		maxSteps: getBudget("settings", 6),
		inputSchema: settingsTaskInputSchema,
	}),
	validator: specialist("validator", "toolloop", [], {
		model: (config) => config.modelPolicy.validatorModelId ?? highReasoningModel(config),
		maxSteps: getBudget("validator", 4),
		resultSchema: validatorResultSchema,
	}),
}

export function getSpecialistDefinition(kind: SpecialistKind): SpecialistDefinition {
	return SPECIALIST_REGISTRY[kind]
}

export function resolveVisibleTools(
	definition: SpecialistDefinition,
	config: AgentRunConfig,
	toolGroups: ToolGroups,
): ToolSet {
	const allowedGroups = new Set(
		(config.policy.allowedToolGroups?.length
			? definition.toolGroups.filter((group) => config.policy.allowedToolGroups?.includes(group))
			: definition.toolGroups
		).filter((group) => {
			if (group === "integration" && !config.runtime.integrationEnabled) return false
			if (group === "cua" && !config.runtime.cuaEnabled) return false
			if (
				(group === "sandbox-read" || group === "sandbox-write") &&
				!config.runtime.sandboxEnabled
			) {
				return false
			}
			return true
		}),
	)

	const tools: ToolSet = {}
	for (const group of allowedGroups) {
		Object.assign(tools, toolGroups[group] ?? {})
	}
	return tools
}
