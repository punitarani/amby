import { z } from "zod"
import type { JsonValue } from "../types/persistence"

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(jsonValueSchema)]),
)

const jsonObjectSchema = z.record(z.unknown())
const jsonShallowValueSchema = z.union([
	jsonPrimitiveSchema,
	z.array(z.union([jsonPrimitiveSchema, jsonObjectSchema])),
	jsonObjectSchema,
])

export const artifactRefSchema = z.object({
	kind: z.string(),
	title: z.string().optional(),
	uri: z.string().optional(),
	metadata: jsonObjectSchema.optional(),
})

export const taskIssueSchema = z.object({
	code: z.string(),
	message: z.string(),
	metadata: jsonObjectSchema.optional(),
})

export const specialistTaskInputSchema = z.object({
	kind: z.literal("specialist"),
	goal: z.string(),
	context: z.string().optional(),
	expectedOutput: z.string().optional(),
	payload: jsonShallowValueSchema.optional(),
})

export const specialistResultSchema = z.object({
	summary: z.string(),
	data: jsonShallowValueSchema.optional(),
	artifacts: z.array(artifactRefSchema).optional(),
	issues: z.array(taskIssueSchema).optional(),
})

export const browserTaskInputSchema = z.object({
	mode: z.enum(["extract", "act", "agent"]),
	instruction: z.string(),
	startUrl: z.string().optional(),
	maxSteps: z.number().int().positive().optional(),
	expectedOutcome: z.string().optional(),
	sideEffectLevel: z.enum(["read", "soft-write", "hard-write"]),
	outputSchema: z.unknown().optional(),
})

export const settingsTaskInputSchema = z.union([
	z.object({
		kind: z.literal("timezone"),
		timezone: z.string(),
	}),
	z.object({
		kind: z.literal("schedule"),
		description: z.string(),
		schedule: jsonShallowValueSchema,
	}),
	z.object({
		kind: z.literal("codex_auth"),
		action: z.enum(["status", "start_chatgpt", "set_api_key", "import_auth", "clear"]),
		apiKey: z.string().optional(),
		authJson: z.string().optional(),
	}),
])

export const executionTaskSchema = z.object({
	specialist: z.enum([
		"planner",
		"research",
		"builder",
		"integration",
		"computer",
		"browser",
		"memory",
		"settings",
		"validator",
	]),
	runnerKind: z.enum(["toolloop", "browser_service", "background_handoff"]),
	mode: z.enum(["direct", "sequential", "parallel", "background"]),
	input: z.union([
		specialistTaskInputSchema,
		z.object({ kind: z.literal("browser"), task: browserTaskInputSchema }),
		z.object({ kind: z.literal("settings"), task: settingsTaskInputSchema }),
		z.object({
			kind: z.literal("background"),
			prompt: z.string(),
			context: z.string().optional(),
			needsBrowser: z.boolean().optional(),
			instructions: z.string().optional(),
		}),
	]),
	dependencies: z.array(z.string()),
	inputBindings: jsonObjectSchema.default({}),
	resourceLocks: z.array(z.string()),
	mutates: z.boolean(),
	writesExternal: z.boolean(),
	requiresConfirmation: z.boolean(),
	requiresValidation: z.boolean(),
})

export const executionPlanSchema = z.object({
	strategy: z.enum(["direct", "sequential", "parallel", "background"]),
	rationale: z.string(),
	tasks: z.array(executionTaskSchema),
	reducer: z.enum(["conversation", "validator"]),
})

export const validatorResultSchema = z.object({
	ok: z.boolean(),
	summary: z.string(),
	issues: z.array(taskIssueSchema).optional(),
	data: jsonObjectSchema.optional(),
})
