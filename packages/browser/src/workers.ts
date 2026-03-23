import type { WorkerBindings } from "@amby/env/workers"
import { AISdkClient, type LLMClient, Stagehand } from "@browserbasehq/stagehand"
import type { BrowserWorker } from "@cloudflare/playwright"
import { Effect, Layer } from "effect"
import { createWorkersAI } from "workers-ai-provider"
import {
	BrowserError,
	BrowserService,
	type BrowserTaskInput,
	type BrowserTaskPage,
	type BrowserTaskResult,
	type BrowserTaskStatus,
	buildBrowserSummary,
	DEFAULT_BROWSER_MAX_STEPS,
	isBrowserEscalationSignal,
	summarizePageArtifact,
} from "./shared"

export const STAGEHAND_MODEL = "@cf/moonshotai/kimi-k2.5"

const BROWSER_AGENT_SYSTEM_PROMPT = [
	"You are a browser specialist.",
	"Stay within the current tab unless the instruction explicitly requires otherwise.",
	"Use DOM interactions and page navigation for same-tab web work.",
	"If the task requires a native dialog, file picker, download/upload flow, CAPTCHA, MFA, multi-tab behavior, or OS-level interaction, stop and say it requires computer escalation.",
].join(" ")

type BrowserWorkerBindings = Pick<
	WorkerBindings,
	"BROWSER" | "AI" | "CLOUDFLARE_AI_GATEWAY_ID" | "NODE_ENV"
>

export interface BrowserWorkerSettings {
	enabled: boolean
	llmClient: LLMClient
	model: string
	providerLabel: string
	browserBinding: unknown
	verbose: 0 | 1
}

function trim(value: string | undefined): string {
	return value?.trim() ?? ""
}

function mapUsage(usage: unknown): BrowserTaskResult["metrics"] | undefined {
	if (!usage || typeof usage !== "object") return undefined

	const record = usage as Record<string, unknown>
	const inputTokens = record.input_tokens
	const outputTokens = record.output_tokens
	const reasoningTokens = record.reasoning_tokens
	const cachedInputTokens = record.cached_input_tokens
	const inferenceTimeMs = record.inference_time_ms

	return {
		inputTokens: typeof inputTokens === "number" ? inputTokens : undefined,
		outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
		reasoningTokens: typeof reasoningTokens === "number" ? reasoningTokens : undefined,
		cachedInputTokens: typeof cachedInputTokens === "number" ? cachedInputTokens : undefined,
		inferenceTimeMs: typeof inferenceTimeMs === "number" ? inferenceTimeMs : undefined,
	}
}

function createStagehandWorkersAiClient(
	ai: NonNullable<WorkerBindings["AI"]>,
	aiGatewayId: string,
): {
	llmClient: LLMClient
	model: string
	providerLabel: string
} {
	const gatewayId = trim(aiGatewayId)
	const binding = ai as NonNullable<Parameters<typeof createWorkersAI>[0]["binding"]>
	const workersai = createWorkersAI({
		binding,
		gateway: gatewayId ? { id: gatewayId } : undefined,
	} as Parameters<typeof createWorkersAI>[0])
	const stagehandModel = STAGEHAND_MODEL as Parameters<typeof workersai>[0]

	return {
		llmClient: new AISdkClient({
			// `workers-ai-provider@0.7.5` model unions lag the current Workers AI catalog.
			model: workersai(stagehandModel),
		}),
		model: STAGEHAND_MODEL,
		providerLabel: gatewayId ? `Workers AI via AI Gateway "${gatewayId}"` : "Workers AI binding",
	}
}

function browserWorkerSettingsFromBindings(
	bindings: BrowserWorkerBindings,
): BrowserWorkerSettings | null {
	const browserBinding = bindings.BROWSER
	const ai = bindings.AI
	const aiGatewayId = trim(bindings.CLOUDFLARE_AI_GATEWAY_ID)
	const verbose = trim(bindings.NODE_ENV) === "development" ? 1 : 0

	if (!browserBinding || !ai) {
		return null
	}

	const { llmClient, model, providerLabel } = createStagehandWorkersAiClient(ai, aiGatewayId)

	return {
		enabled: true,
		llmClient,
		model,
		providerLabel,
		browserBinding,
		verbose,
	}
}

async function resolveBrowserPageTitle(stagehand: Stagehand): Promise<BrowserTaskPage> {
	const page = stagehand.context.pages()[0]
	if (!page) return { url: null, title: null }

	const [url, title] = await Promise.all([
		Promise.resolve(trim(page.url()) || null),
		page.title().catch(() => null),
	])

	return {
		url,
		title: trim(title ?? undefined) || null,
	}
}

function buildBrowserInstruction(input: BrowserTaskInput): string {
	const parts = [input.instruction.trim()]

	if (input.expectedOutcome?.trim()) {
		parts.push(`Expected outcome: ${input.expectedOutcome.trim()}`)
	}

	parts.push(`Side effect level: ${input.sideEffectLevel}.`)

	if (input.sideEffectLevel === "read") {
		parts.push(
			"Prefer read-only page inspection. If the task cannot be completed without writes, return escalate.",
		)
	}

	if (input.sideEffectLevel === "hard-write") {
		parts.push("Perform irreversible writes only when the instruction explicitly requires them.")
	}

	return parts.join("\n\n")
}

function isEscalationResult(status: BrowserTaskStatus, message: string, output: unknown): boolean {
	return (
		status !== "escalate" &&
		(isBrowserEscalationSignal(message) || isBrowserEscalationSignal(output))
	)
}

function summarizeText(mode: BrowserTaskInput["mode"], page: BrowserTaskPage, text?: string) {
	const trimmed = text?.trim()
	if (trimmed) return trimmed
	return buildBrowserSummary(mode, "completed", page, "Browser task completed.")
}

async function runBrowserTask(
	settings: BrowserWorkerSettings,
	input: BrowserTaskInput,
): Promise<BrowserTaskResult> {
	if (!settings.browserBinding) {
		throw new BrowserError({ message: "Browser Rendering binding is not configured." })
	}

	const startedAt = Date.now()

	if (settings.verbose) {
		console.info(`[BrowserService] LLM: ${settings.model} via ${settings.providerLabel}`)
	}

	const { endpointURLString } = await import("@cloudflare/playwright")
	const stagehandLogger = (entry: { level?: number; message: string; [key: string]: unknown }) => {
		if (entry.message === "Custom LLM clients are currently not supported in API mode") {
			return
		}

		if ((entry.level ?? 1) <= 0) {
			console.warn(entry)
			return
		}

		if (settings.verbose) {
			console.info(entry)
		}
	}

	const stagehand = new Stagehand({
		env: "LOCAL",
		verbose: settings.verbose ? 2 : 1,
		logger: stagehandLogger,
		modelName: settings.model,
		llmClient: settings.llmClient,
		localBrowserLaunchOptions: {
			cdpUrl: endpointURLString(settings.browserBinding as BrowserWorker),
		},
	})

	let initialized = false
	try {
		await stagehand.init()
		initialized = true

		const normalized = {
			...input,
			instruction: input.instruction.trim(),
			startUrl: trim(input.startUrl) || undefined,
			expectedOutcome: trim(input.expectedOutcome) || undefined,
		}
		const startUrl = trim(normalized.startUrl)
		if (startUrl) {
			if (!/^https?:\/\//i.test(startUrl)) {
				throw new BrowserError({
					message: `Invalid startUrl scheme (only http/https allowed): ${startUrl}`,
				})
			}

			const page = stagehand.context.pages()[0]
			if (!page) {
				throw new BrowserError({ message: "Browser page unavailable after initialization." })
			}

			await page.goto(startUrl)
		}

		switch (normalized.mode) {
			case "extract": {
				const page = stagehand.context.pages()[0]
				if (!page) throw new BrowserError({ message: "Browser page unavailable." })

				const extraction =
					normalized.outputSchema != null
						? await page.extract({
								instruction: normalized.instruction,
								schema: normalized.outputSchema,
							})
						: await page.extract({
								instruction: normalized.instruction,
							})

				const pageInfo = await resolveBrowserPageTitle(stagehand)
				const output =
					extraction && typeof extraction === "object" && "data" in extraction
						? ((extraction as { data?: unknown }).data as BrowserTaskResult["output"])
						: (extraction as BrowserTaskResult["output"])
				const summary = summarizeText(
					"extract",
					pageInfo,
					"Structured data extracted from the page.",
				)

				return {
					status: "completed",
					summary,
					page: pageInfo,
					output,
					artifacts: summarizePageArtifact(pageInfo),
					issues: [],
					metrics: {
						steps: 1,
						durationMs: Date.now() - startedAt,
					},
				}
			}
			case "act": {
				const page = stagehand.context.pages()[0]
				if (!page) throw new BrowserError({ message: "Browser page unavailable." })

				const result = (await page.act(normalized.instruction)) as {
					success?: boolean
					message?: string
					actions?: unknown[]
					usage?: unknown
				}

				const pageInfo = await resolveBrowserPageTitle(stagehand)
				const summary = summarizeText("act", pageInfo, result.message)
				const escalated = isEscalationResult(
					result.success === false ? "partial" : "completed",
					summary,
					result,
				)

				return {
					status: escalated ? "escalate" : result.success === false ? "partial" : "completed",
					summary,
					page: pageInfo,
					actions: Array.isArray(result.actions)
						? (result.actions as BrowserTaskResult["actions"])
						: [],
					artifacts: summarizePageArtifact(pageInfo),
					issues: result.success === false ? [summary] : [],
					metrics: {
						steps: Array.isArray(result.actions) ? result.actions.length : 1,
						durationMs: Date.now() - startedAt,
						...mapUsage(result.usage),
					},
				}
			}
			case "agent": {
				const agent = stagehand.agent({
					instructions: BROWSER_AGENT_SYSTEM_PROMPT,
				})

				const result = (await agent.execute({
					instruction: buildBrowserInstruction(normalized),
					maxSteps: normalized.maxSteps ?? DEFAULT_BROWSER_MAX_STEPS,
				})) as {
					success?: boolean
					completed?: boolean
					message?: string
					actions?: unknown[]
					steps?: unknown[]
					usage?: unknown
				}

				const pageInfo = await resolveBrowserPageTitle(stagehand)
				const summary = summarizeText("agent", pageInfo, result.message)
				const completed = result.completed ?? result.success
				let output: BrowserTaskResult["output"] | undefined
				const issues: string[] = []

				if (normalized.outputSchema != null) {
					const page = stagehand.context.pages()[0]
					if (page) {
						try {
							const extraction = await page.extract({
								instruction: normalized.expectedOutcome?.trim() || normalized.instruction,
								schema: normalized.outputSchema,
							})
							output =
								extraction && typeof extraction === "object" && "data" in extraction
									? ((extraction as { data?: unknown }).data as BrowserTaskResult["output"])
									: (extraction as BrowserTaskResult["output"])
						} catch (cause) {
							issues.push(cause instanceof Error ? cause.message : String(cause))
						}
					} else {
						issues.push("Browser page unavailable for structured output extraction.")
					}
				}

				if (output !== undefined && issues.length > 0) {
					issues.unshift("Structured output extraction did not complete cleanly.")
				}

				const escalated = isEscalationResult(
					completed === false ? "partial" : "completed",
					summary,
					result,
				)

				return {
					status: escalated
						? "escalate"
						: completed === false || issues.length > 0
							? "partial"
							: "completed",
					summary,
					page: pageInfo,
					output,
					actions: Array.isArray(result.actions)
						? (result.actions as BrowserTaskResult["actions"])
						: [],
					artifacts: summarizePageArtifact(pageInfo),
					issues: completed === false ? [summary, ...issues] : issues,
					metrics: {
						steps: Array.isArray(result.steps)
							? result.steps.length
							: (normalized.maxSteps ?? DEFAULT_BROWSER_MAX_STEPS),
						durationMs: Date.now() - startedAt,
						...mapUsage(result.usage),
					},
				}
			}
		}
		throw new BrowserError({
			message: `Unsupported browser task mode: ${(normalized as { mode?: string }).mode ?? "unknown"}`,
		})
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause)
		if (isBrowserEscalationSignal(message) || isBrowserEscalationSignal(cause)) {
			const pageInfo = await resolveBrowserPageTitle(stagehand).catch(() => ({
				url: null,
				title: null,
			}))
			return {
				status: "escalate",
				summary: message,
				page: pageInfo,
				artifacts: summarizePageArtifact(pageInfo),
				issues: [message],
				metrics: {
					durationMs: Date.now() - startedAt,
				},
			}
		}

		throw new BrowserError({
			message,
			cause,
		})
	} finally {
		if (initialized) {
			await stagehand.close().catch((err) => {
				console.warn("[BrowserService] stagehand.close() failed:", err)
			})
		}
	}
}

export const makeBrowserServiceFromBindings = (bindings: BrowserWorkerBindings) => {
	const settings = browserWorkerSettingsFromBindings(bindings)

	if (!settings) {
		return Layer.succeed(BrowserService, {
			enabled: false,
			runTask: () =>
				Effect.fail(
					new BrowserError({
						message:
							'Browser LLM requires BROWSER and Workers AI ([ai] binding = "AI"). Optional: CLOUDFLARE_AI_GATEWAY_ID.',
					}),
				),
		})
	}

	return Layer.succeed(BrowserService, {
		enabled: settings.enabled,
		runTask: (input) =>
			Effect.tryPromise({
				try: () => runBrowserTask(settings, input),
				catch: (cause) =>
					cause instanceof BrowserError
						? cause
						: new BrowserError({
								message:
									cause instanceof Error ? cause.message : "Browser task failed unexpectedly.",
								cause,
							}),
			}),
	})
}
