import type { WorkerBindings } from "@amby/env/workers"
import { AISdkClient, Stagehand } from "@browserbasehq/stagehand"
import type { BrowserWorker } from "@cloudflare/playwright"
import { Effect, Layer } from "effect"
import { createWorkersAI } from "workers-ai-provider"
import { BrowserError, BrowserService, type BrowserTaskResult } from "./shared"

/** Workers AI model via Cloudflare AI Gateway */
export const STAGEHAND_MODEL = "@cf/moonshotai/kimi-k2.5"

const DEFAULT_BROWSER_MAX_STEPS = 100

const BROWSER_AGENT_INSTRUCTIONS = [
	"You are a browser-only agent.",
	"Stay within a single browser tab.",
	"Do not rely on desktop or operating-system interaction.",
	"Only perform actions that are clearly requested in the instruction.",
	"If the task requires new tabs, popups, native file dialogs, downloads/uploads, CAPTCHA, MFA, login handoffs, or other non-single-tab behavior, stop and say it requires computer access.",
].join(" ")

type BrowserWorkerBindings = Pick<
	WorkerBindings,
	"BROWSER" | "AI" | "CLOUDFLARE_AI_GATEWAY_ID" | "NODE_ENV"
>

export interface BrowserWorkerSettings {
	enabled: boolean
	llmClient: AISdkClient
	/** AI Gateway id from `CLOUDFLARE_AI_GATEWAY_ID`. */
	aiGatewayId: string
	model: string
	browserBinding: unknown
	verbose: 0 | 1
}

function trim(value: string | undefined): string {
	return value?.trim() ?? ""
}

function createStagehandLlmClient(
	ai: NonNullable<WorkerBindings["AI"]>,
	aiGatewayId: string,
): AISdkClient {
	const workersai = createWorkersAI({
		binding: ai,
		gateway: { id: aiGatewayId },
	} as Parameters<typeof createWorkersAI>[0])
	// workers-ai-provider v3 emits AI SDK v3 models; Stagehand 2.5 typings target older LanguageModel shapes.
	return new AISdkClient({
		model: workersai(STAGEHAND_MODEL) as unknown as ConstructorParameters<
			typeof AISdkClient
		>[0]["model"],
	})
}

function browserWorkerSettingsFromBindings(
	bindings: BrowserWorkerBindings,
): BrowserWorkerSettings | null {
	const ai = bindings.AI
	const browserBinding = bindings.BROWSER
	const aiGatewayId = trim(bindings.CLOUDFLARE_AI_GATEWAY_ID)
	const verbose = trim(bindings.NODE_ENV) === "development" ? 1 : 0

	if (!browserBinding || !ai || !aiGatewayId) {
		return null
	}

	return {
		enabled: true,
		llmClient: createStagehandLlmClient(ai, aiGatewayId),
		aiGatewayId,
		model: STAGEHAND_MODEL,
		browserBinding,
		verbose,
	}
}

async function runBrowserTask(
	settings: BrowserWorkerSettings,
	task: string,
	startUrl?: string,
): Promise<BrowserTaskResult> {
	if (!settings.browserBinding) {
		throw new BrowserError({ message: "Browser Rendering binding is not configured." })
	}

	if (settings.verbose) {
		console.info(
			`[BrowserService] LLM: Workers AI ${settings.model} via AI Gateway "${settings.aiGatewayId}" (workers-ai-provider + AISdkClient)`,
		)
	}

	const { endpointURLString } = await import("@cloudflare/playwright")
	const stagehand = new Stagehand({
		env: "LOCAL",
		useAPI: false,
		verbose: settings.verbose ? 2 : 1,
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

		const rawUrl = trim(startUrl)
		if (rawUrl) {
			if (!/^https?:\/\//i.test(rawUrl)) {
				throw new BrowserError({
					message: `Invalid startUrl scheme (only http/https allowed): ${rawUrl}`,
				})
			}
			await stagehand.page.goto(rawUrl)
		}

		const agent = stagehand.agent({
			instructions: BROWSER_AGENT_INSTRUCTIONS,
		})
		const result = await agent.execute({
			instruction: task,
			maxSteps: DEFAULT_BROWSER_MAX_STEPS,
		})

		const currentUrl = stagehand.page.url()
		const title = await stagehand.page.title().catch(() => null)
		const summary = result.message.trim() || "Browser task completed without a summary."

		return {
			success: result.success,
			summary,
			finalUrl: currentUrl ? currentUrl.trim() : null,
			title: title?.trim() || null,
		}
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
							'Browser LLM requires BROWSER, Workers AI ([ai] binding = "AI"), and CLOUDFLARE_AI_GATEWAY_ID (AI Gateway slug).',
					}),
				),
		})
	}

	return Layer.succeed(BrowserService, {
		enabled: settings.enabled,
		runTask: ({ task, startUrl }) =>
			Effect.tryPromise({
				try: () => runBrowserTask(settings, task, startUrl),
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
