import { createOpenAI } from "@ai-sdk/openai"
import type { WorkerBindings } from "@amby/env/workers"
import { type AISdkClient, Stagehand } from "@browserbasehq/stagehand"
import type { BrowserWorker } from "@cloudflare/playwright"
import { Effect, Layer } from "effect"
import { BrowserError, BrowserService, type BrowserTaskResult } from "./shared"

const DEFAULT_BROWSER_STAGEHAND_MODEL = "google/gemini-3-flash-preview"
const DEFAULT_BROWSER_MAX_STEPS = 20

const BROWSER_AGENT_INSTRUCTIONS = [
	"You are a browser-only agent.",
	"Stay within a single browser tab.",
	"Do not rely on desktop or operating-system interaction.",
	"Only perform actions that are clearly requested in the instruction.",
	"If the task requires new tabs, popups, native file dialogs, downloads/uploads, CAPTCHA, MFA, login handoffs, or other non-single-tab behavior, stop and say it requires computer access.",
].join(" ")

type BrowserWorkerBindings = Pick<
	WorkerBindings,
	| "BROWSER"
	| "BROWSER_AI_GATEWAY_BASE_URL"
	| "BROWSER_AI_GATEWAY_AUTH_TOKEN"
	| "BROWSER_STAGEHAND_MODEL"
	| "NODE_ENV"
>

export interface BrowserWorkerSettings {
	enabled: boolean
	baseURL: string
	authToken: string
	model: string
	browserBinding: unknown
	verbose: 0 | 1
}

function normalizeNonEmpty(value: string | undefined): string {
	return value?.trim() ?? ""
}

function withoutTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "")
}

function parseHttpUrl(value: string): string {
	let url: URL

	try {
		url = new URL(value)
	} catch {
		throw new BrowserError({ message: `Invalid startUrl: ${value}` })
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new BrowserError({
			message: `Invalid startUrl scheme (only http/https allowed): ${value}`,
		})
	}

	return url.toString()
}

export function resolveBrowserWorkerSettings(
	bindings: BrowserWorkerBindings,
): BrowserWorkerSettings {
	const baseURL = withoutTrailingSlash(normalizeNonEmpty(bindings.BROWSER_AI_GATEWAY_BASE_URL))
	const authToken = normalizeNonEmpty(bindings.BROWSER_AI_GATEWAY_AUTH_TOKEN)
	const model =
		normalizeNonEmpty(bindings.BROWSER_STAGEHAND_MODEL) || DEFAULT_BROWSER_STAGEHAND_MODEL
	const browserBinding = bindings.BROWSER
	const verbose = normalizeNonEmpty(bindings.NODE_ENV) === "development" ? 1 : 0

	return {
		enabled: Boolean(browserBinding && baseURL),
		baseURL,
		authToken,
		model,
		browserBinding,
		verbose,
	}
}

async function createAISdkClient(
	settings: BrowserWorkerSettings,
): Promise<InstanceType<typeof AISdkClient>> {
	const openai = createOpenAI({
		baseURL: settings.baseURL,
		compatibility: "compatible",
		name: "openrouter-gateway",
		headers: settings.authToken
			? {
					"cf-aig-authorization": settings.authToken,
				}
			: undefined,
	})

	const { AISdkClient } = await import("@browserbasehq/stagehand")
	return new AISdkClient({
		model: openai.chat(settings.model),
	})
}

async function runBrowserTask(
	settings: BrowserWorkerSettings,
	task: string,
	startUrl?: string,
): Promise<BrowserTaskResult> {
	if (!settings.browserBinding) {
		throw new BrowserError({ message: "Browser Rendering binding is not configured." })
	}

	if (!settings.baseURL) {
		throw new BrowserError({ message: "Browser AI Gateway base URL is not configured." })
	}

	const llmClient = await createAISdkClient(settings)
	const { endpointURLString } = await import("@cloudflare/playwright")
	const stagehand = new Stagehand({
		env: "LOCAL",
		verbose: process.env.NODE_ENV === "development" ? 1 : 0,
		llmClient,
		localBrowserLaunchOptions: {
			cdpUrl: endpointURLString(settings.browserBinding as never),
		},
	})

	try {
		await stagehand.init()

		const rawUrl = normalizeNonEmpty(startUrl)
		if (rawUrl) {
			await stagehand.page.goto(parseHttpUrl(rawUrl))
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
		await stagehand.close().catch((error) => {
	} finally {
		await stagehand.close().catch((err) => {
			console.warn("[BrowserService] stagehand.close() failed:", err)
		})
	}
}

export const makeBrowserServiceFromBindings = (bindings: BrowserWorkerBindings) => {
	const settings = resolveBrowserWorkerSettings(bindings)

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
