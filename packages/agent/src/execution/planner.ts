import { sanitizeBrowserStartUrl } from "@amby/browser"
import type { SpecialistKind } from "@amby/db"
import { generateObject, type LanguageModel } from "ai"
import { executionPlanSchema } from "../specialists/schemas"
import type { AgentRunConfig } from "../types/agent"
import type { BrowserTaskInput } from "../types/browser"
import type { ExecutionPlan, ExecutionTaskInput, PlannedTask } from "../types/execution"
import type { SettingsTaskInput } from "../types/settings"
import { getSpecialistDefinition } from "./registry"

type CodexAuthAction = Extract<SettingsTaskInput, { kind: "codex_auth" }>["action"]

type PlannerInput = {
	request: string
	config: AgentRunConfig
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g
const INTEGRATION_RE = /\b(gmail|google calendar|calendar|notion|slack|drive|google drive)\b/i
const SETTINGS_RE =
	/\b(timezone|remind|reminder|schedule|every day|every week|codex|api key|auth)\b/i
const MEMORY_RE = /\b(remember this|remember that|don't forget|save this|keep this in mind)\b/i
const COMPUTER_RE =
	/\b(desktop|computer|upload|download|file picker|native dialog|captcha|mfa|multi-tab|popup|screenshot)\b/i
const BROWSER_RE = /\b(browser|website|web page|site|open the page|visit)\b/i
const BUILDER_RE =
	/\b(implement|refactor|rewrite|fix|patch|edit|modify|create file|write code|build|test)\b/i
const RESEARCH_RE = /\b(research|investigate|look up|analyze|inspect|summarize|read|compare)\b/i
const BACKGROUND_RE =
	/\b(background|autonomous|take your time|long-running|work on this over time)\b/i
const HARD_WRITE_RE = /\b(send|post|submit|purchase|buy|delete|update|create event|email)\b/i

function contains(text: string, pattern: RegExp) {
	return pattern.test(text)
}

function extractUrls(text: string): string[] {
	return [
		...new Set(
			[...text.matchAll(URL_RE)]
				.map((match) => sanitizeBrowserStartUrl(match[0]))
				.filter((url): url is string => Boolean(url)),
		),
	]
}

function extractPathHints(text: string): string[] {
	const matches = text.match(/\/[A-Za-z0-9._~/-]+/g) ?? []
	return [...new Set(matches)]
}

function createSpecialistTask(
	agent: SpecialistKind,
	input: ExecutionTaskInput,
	options?: {
		dependencies?: string[]
		resourceLocks?: string[]
		mutates?: boolean
		writesExternal?: boolean
		requiresConfirmation?: boolean
		requiresValidation?: boolean
	},
): PlannedTask {
	const definition = getSpecialistDefinition(agent)
	return {
		parentTaskId: undefined,
		spawnedBySpecialist: undefined,
		specialist: agent,
		runnerKind: definition.runnerKind,
		mode: definition.runnerKind === "background_handoff" ? "background" : "sequential",
		input,
		dependencies: options?.dependencies ?? [],
		inputBindings: {},
		resourceLocks: options?.resourceLocks ?? [],
		mutates: options?.mutates ?? false,
		writesExternal: options?.writesExternal ?? false,
		requiresConfirmation: options?.requiresConfirmation ?? false,
		requiresValidation: options?.requiresValidation ?? false,
	}
}

function createBrowserTask(params: {
	instruction: string
	startUrl?: string
	outputMode?: BrowserTaskInput["mode"]
	sideEffectLevel?: BrowserTaskInput["sideEffectLevel"]
	expectedOutcome?: string
}): PlannedTask {
	return createSpecialistTask(
		"browser",
		{
			kind: "browser",
			task: {
				mode: params.outputMode ?? "agent",
				instruction: params.instruction,
				startUrl: params.startUrl,
				expectedOutcome: params.expectedOutcome,
				sideEffectLevel: params.sideEffectLevel ?? "read",
			},
		},
		{
			mutates: params.sideEffectLevel !== "read",
			writesExternal: params.sideEffectLevel === "hard-write",
			requiresConfirmation: params.sideEffectLevel === "hard-write",
		},
	)
}

function createBackgroundTask(prompt: string, needsBrowser: boolean): PlannedTask {
	return {
		...createSpecialistTask(
			"builder",
			{
				kind: "background",
				prompt,
				needsBrowser,
				instructions: "Work autonomously to completion and write final results into artifacts.",
			},
			{
				resourceLocks: ["sandbox-workdir:/"],
				mutates: true,
			},
		),
		runnerKind: "background_handoff",
		mode: "background",
	}
}

function browserParallelPlan(request: string, urls: string[]): ExecutionPlan {
	const tasks = urls
		.map((url) =>
			createBrowserTask({
				instruction: `Open ${url} and extract the information needed for this request: ${request}`,
				startUrl: url,
				outputMode: "extract",
				sideEffectLevel: "read",
				expectedOutcome: "Return the relevant findings in structured form when possible.",
			}),
		)
		.map((task, index) => ({
			...task,
			inputBindings: { urlIndex: index },
		}))

	return {
		strategy: "parallel",
		rationale:
			"The request references multiple independent URLs that can be inspected concurrently.",
		tasks,
		reducer: "conversation",
	}
}

export function buildHeuristicPlan({ request }: PlannerInput): ExecutionPlan {
	const normalized = request.trim()
	const normalizedLower = normalized.toLowerCase()
	const urls = extractUrls(normalized)
	const pathHints = extractPathHints(normalized)
	const wantsBackground = contains(normalized, BACKGROUND_RE)
	const wantsSettings = contains(normalized, SETTINGS_RE)
	const wantsMemory = contains(normalized, MEMORY_RE)
	const wantsIntegration = contains(normalized, INTEGRATION_RE)
	const wantsComputer = contains(normalized, COMPUTER_RE)
	const wantsBrowser = urls.length > 0 || contains(normalized, BROWSER_RE)
	const wantsBuilder = contains(normalized, BUILDER_RE)
	const wantsResearch = contains(normalized, RESEARCH_RE)

	if (
		!wantsBackground &&
		!wantsSettings &&
		!wantsMemory &&
		!wantsIntegration &&
		!wantsComputer &&
		!wantsBrowser &&
		!wantsBuilder &&
		!wantsResearch
	) {
		return {
			strategy: "direct",
			rationale: "No specialist execution is required for this request.",
			tasks: [],
			reducer: "conversation",
		}
	}

	if (urls.length > 1 && !contains(normalized, HARD_WRITE_RE) && !wantsComputer) {
		return browserParallelPlan(normalized, urls)
	}

	if (wantsBackground) {
		return {
			strategy: "background",
			rationale: "The request explicitly asks for a long-running autonomous background task.",
			tasks: [createBackgroundTask(normalized, wantsBrowser)],
			reducer: "conversation",
		}
	}

	if (wantsSettings) {
		const settingsTask: { kind: "settings"; task: SettingsTaskInput } = normalizedLower.includes(
			"timezone",
		)
			? {
					kind: "settings" as const,
					task: {
						kind: "timezone" as const,
						timezone: normalized,
					},
				}
			: normalizedLower.includes("remind") || normalizedLower.includes("schedule")
				? {
						kind: "settings" as const,
						task: {
							kind: "schedule" as const,
							description: normalized,
							schedule: { request: normalized },
						},
					}
				: {
						kind: "settings" as const,
						task: {
							kind: "codex_auth" as const,
							action: (normalizedLower.includes("status")
								? "status"
								: normalizedLower.includes("api key")
									? "set_api_key"
									: normalizedLower.includes("clear")
										? "clear"
										: "start_chatgpt") as CodexAuthAction,
						},
					}

		return {
			strategy: "sequential",
			rationale: "The request is a settings or scheduling operation.",
			tasks: [createSpecialistTask("settings", settingsTask, { mutates: true })],
			reducer: "conversation",
		}
	}

	if (wantsMemory) {
		return {
			strategy: "sequential",
			rationale: "The request is asking to save or manage memory.",
			tasks: [
				createSpecialistTask(
					"memory",
					{
						kind: "specialist",
						goal: normalized,
						payload: { request: normalized },
					},
					{
						resourceLocks: ["memory-write"],
						mutates: true,
					},
				),
			],
			reducer: "conversation",
		}
	}

	if (wantsIntegration) {
		return {
			strategy: "sequential",
			rationale: "The request depends on connected-app tooling.",
			tasks: [
				createSpecialistTask(
					"integration",
					{
						kind: "specialist",
						goal: normalized,
						payload: { request: normalized },
					},
					{
						resourceLocks: ["integration-write:external"],
						mutates: contains(normalized, HARD_WRITE_RE),
						writesExternal: contains(normalized, HARD_WRITE_RE),
						requiresConfirmation: contains(normalized, HARD_WRITE_RE),
						requiresValidation: contains(normalized, HARD_WRITE_RE),
					},
				),
			],
			reducer: contains(normalized, HARD_WRITE_RE) ? "validator" : "conversation",
		}
	}

	if (wantsComputer) {
		return {
			strategy: "sequential",
			rationale: "The request requires desktop-level interaction.",
			tasks: [
				createSpecialistTask(
					"computer",
					{
						kind: "specialist",
						goal: normalized,
						payload: { request: normalized },
					},
					{
						resourceLocks: ["computer-desktop"],
						mutates: true,
						requiresConfirmation: contains(normalized, HARD_WRITE_RE),
					},
				),
			],
			reducer: "conversation",
		}
	}

	if (wantsBrowser && wantsResearch) {
		return {
			strategy: "parallel",
			rationale: "The request contains independent read-heavy browser and research work.",
			tasks: [
				createBrowserTask({
					instruction: normalized,
					startUrl: urls[0],
					outputMode: "extract",
					sideEffectLevel: "read",
				}),
				createSpecialistTask("research", {
					kind: "specialist",
					goal: normalized,
					payload: { request: normalized },
				}),
			],
			reducer: "conversation",
		}
	}

	if (wantsBuilder && wantsResearch) {
		return {
			strategy: "sequential",
			rationale: "The request needs investigation before changes are made.",
			tasks: [
				createSpecialistTask("research", {
					kind: "specialist",
					goal: normalized,
					payload: { request: normalized },
				}),
				createSpecialistTask(
					"builder",
					{
						kind: "specialist",
						goal: normalized,
						payload: { request: normalized, pathHints },
					},
					{
						dependencies: ["task-0"],
						resourceLocks:
							pathHints.length > 0
								? pathHints.map((path) => `fs-write:${path}`)
								: ["sandbox-workdir:/"],
						mutates: true,
						requiresValidation: true,
					},
				),
			],
			reducer: "validator",
		}
	}

	if (wantsBuilder) {
		return {
			strategy: "sequential",
			rationale: "The request requires filesystem or code changes.",
			tasks: [
				createSpecialistTask(
					"builder",
					{
						kind: "specialist",
						goal: normalized,
						payload: { request: normalized, pathHints },
					},
					{
						resourceLocks:
							pathHints.length > 0
								? pathHints.map((path) => `fs-write:${path}`)
								: ["sandbox-workdir:/"],
						mutates: true,
						requiresValidation: true,
					},
				),
			],
			reducer: "validator",
		}
	}

	if (wantsBrowser) {
		return {
			strategy: "sequential",
			rationale: "The request is best handled as browser work.",
			tasks: [
				createBrowserTask({
					instruction: normalized,
					startUrl: urls[0],
					outputMode: contains(normalized, HARD_WRITE_RE) ? "agent" : "extract",
					sideEffectLevel: contains(normalized, HARD_WRITE_RE) ? "soft-write" : "read",
				}),
			],
			reducer: "conversation",
		}
	}

	return {
		strategy: "sequential",
		rationale: "The request requires read-oriented specialist execution.",
		tasks: [
			createSpecialistTask("research", {
				kind: "specialist",
				goal: normalized,
				payload: { request: normalized },
			}),
		],
		reducer: "conversation",
	}
}

export function shouldUseModelPlanner(request: string, heuristicPlan: ExecutionPlan) {
	if (heuristicPlan.strategy === "direct") return false
	if (heuristicPlan.tasks.length >= 3) return true
	return /\b(plan|carefully|step by step|then|after that|sequence)\b/i.test(request)
}

function rewritePlanTaskIds(plan: ExecutionPlan): ExecutionPlan {
	return {
		...plan,
		tasks: plan.tasks.map((task) => {
			const dependencyMap = new Map(
				plan.tasks.map((_, sourceIndex) => [`task-${sourceIndex}`, `task-${sourceIndex}`]),
			)
			return {
				...task,
				dependencies: task.dependencies.map(
					(dependency) => dependencyMap.get(dependency) ?? dependency,
				),
			}
		}),
	}
}

export async function buildExecutionPlan(params: {
	request: string
	config: AgentRunConfig
	getModel: (id?: string) => LanguageModel
}): Promise<ExecutionPlan> {
	const heuristicPlan = buildHeuristicPlan({ request: params.request, config: params.config })
	if (!shouldUseModelPlanner(params.request, heuristicPlan)) {
		return rewritePlanTaskIds(heuristicPlan)
	}

	try {
		const { object } = await generateObject({
			model: params.getModel(params.config.modelPolicy.highReasoningModelId),
			schema: executionPlanSchema,
			prompt: [
				"You are planning internal specialist execution.",
				"Choose the cheapest correct strategy.",
				"Use parallel only for independent safe read-heavy tasks.",
				"Use background only for long-running autonomous work.",
				"Return only schema-valid JSON.",
				`Request:\n${params.request}`,
				`Heuristic draft:\n${JSON.stringify(heuristicPlan)}`,
			].join("\n\n"),
		})
		return rewritePlanTaskIds(object as unknown as ExecutionPlan)
	} catch (error) {
		console.warn("[planner] model planner failed, falling back to heuristic plan:", error)
		return rewritePlanTaskIds(heuristicPlan)
	}
}
