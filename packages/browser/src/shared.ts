import { Context, Data, Duration, type Effect, Schedule } from "effect"
import type { z } from "zod"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[]
export type BrowserOutputSchema = z.AnyZodObject

export type BrowserTaskMode = "extract" | "act" | "agent"
export type BrowserTaskSideEffectLevel = "read" | "soft-write" | "hard-write"
export type BrowserTaskStatus = "completed" | "partial" | "failed" | "escalate"

export interface BrowserTaskInput {
	mode: BrowserTaskMode
	instruction: string
	startUrl?: string
	maxSteps?: number
	expectedOutcome?: string
	sideEffectLevel: BrowserTaskSideEffectLevel
	outputSchema?: BrowserOutputSchema
}

export interface BrowserTaskPage {
	url: string | null
	title: string | null
}

export interface BrowserArtifactRef {
	kind: string
	title?: string
	uri?: string
}

export interface BrowserTaskMetrics {
	steps?: number
	durationMs?: number
	inputTokens?: number
	outputTokens?: number
	reasoningTokens?: number
	cachedInputTokens?: number
	inferenceTimeMs?: number
}

export interface BrowserTaskProgressEvent {
	phase?: string
	category?: string
	message: string
	level?: number
	stepIndex?: number
	page?: BrowserTaskPage
	auxiliary?: Record<string, unknown>
}

export interface BrowserTaskRunOptions {
	onProgress?: (event: BrowserTaskProgressEvent) => void | Promise<void>
}

export interface BrowserTaskResult {
	status: BrowserTaskStatus
	summary: string
	page: BrowserTaskPage
	output?: JsonValue
	actions?: JsonValue[]
	artifacts?: BrowserArtifactRef[]
	issues?: string[]
	metrics?: BrowserTaskMetrics
	runtimeData?: Record<string, unknown>
}

export class BrowserError extends Data.TaggedError("BrowserError")<{
	readonly message: string
	readonly cause?: unknown
}> {}

export const DEFAULT_BROWSER_MAX_STEPS = 24

const ESCALATION_PATTERNS = [
	/requires computer access/i,
	/requires desktop access/i,
	/native (?:dialog|file dialog|file picker)/i,
	/new tab/i,
	/popup/i,
	/captcha/i,
	/mfa/i,
	/downloads?/i,
	/uploads?/i,
	/operating-system/i,
]

const READ_HINTS = [
	/\bextract\b/i,
	/\bread\b/i,
	/\bfind\b/i,
	/\blookup\b/i,
	/\bsearch\b/i,
	/\bsummary\b/i,
	/\bsummarize\b/i,
	/\bwhat is\b/i,
]

const LEADING_URL_WRAPPERS_RE = /^[<({["'`]+/
const TRAILING_URL_WRAPPERS_RE = /[>)}\]"'`]+$/
const TRAILING_URL_PUNCTUATION_RE = /[.,!?;:]+$/

export function inferBrowserSideEffectLevel(instruction: string): BrowserTaskSideEffectLevel {
	if (READ_HINTS.some((pattern) => pattern.test(instruction))) {
		return "read"
	}
	return "soft-write"
}

export function sanitizeBrowserStartUrl(value?: string): string | undefined {
	const trimmed = value?.trim()
	if (!trimmed) return undefined

	let candidate = trimmed
	let wrapped = true
	while (wrapped) {
		wrapped = false
		const next = candidate
			.replace(LEADING_URL_WRAPPERS_RE, "")
			.replace(TRAILING_URL_WRAPPERS_RE, "")
			.trim()
		if (next !== candidate) {
			candidate = next
			wrapped = true
		}
	}

	const tryNormalize = (input: string) => {
		try {
			const parsed = new URL(input)
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				return input
			}
			return parsed.toString()
		} catch {
			return null
		}
	}

	const normalized = tryNormalize(candidate)
	if (normalized) return normalized

	let stripped = candidate
	while (TRAILING_URL_PUNCTUATION_RE.test(stripped)) {
		stripped = stripped.replace(TRAILING_URL_PUNCTUATION_RE, "")
		const next = tryNormalize(stripped)
		if (next) return next
	}

	return candidate
}

export function isBrowserEscalationSignal(value: unknown): boolean {
	if (typeof value === "string") {
		return ESCALATION_PATTERNS.some((pattern) => pattern.test(value))
	}

	if (!value || typeof value !== "object") return false

	for (const candidate of Object.values(value as Record<string, unknown>)) {
		if (typeof candidate === "string" && isBrowserEscalationSignal(candidate)) {
			return true
		}
	}

	return false
}

export function summarizePageArtifact(page: BrowserTaskPage): BrowserArtifactRef[] {
	if (!page.url && !page.title) return []
	return [
		{
			kind: "page",
			title: page.title ?? undefined,
			uri: page.url ?? undefined,
		},
	]
}

export function buildBrowserSummary(
	mode: BrowserTaskMode,
	status: BrowserTaskStatus,
	page: BrowserTaskPage,
	fallback: string,
) {
	const title = page.title?.trim()
	const url = page.url?.trim()
	if (status === "escalate") {
		return fallback
	}
	const where = title || url ? ` on ${title ?? url}` : ""
	return mode === "extract"
		? `Extracted browser data${where}.`
		: mode === "act"
			? `Completed browser action${where}.`
			: `Completed browser workflow${where}.`
}

/** Errors that are safe to retry (transient infrastructure issues). */
export function isRetryableBrowserTaskError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	return (
		message.includes("504") ||
		message.includes("502") ||
		message.includes("503") ||
		message.includes("Gateway Time-out") ||
		message.includes("InferenceUpstreamError") ||
		message.includes("ECONNRESET") ||
		message.includes("fetch failed")
	)
}

/** Base step for linear backoff (3s then 6s via `fromDelays`). */
export const BROWSER_TASK_RETRY_DELAY_MS = 3_000

/**
 * Two backoff steps after failures: 3s then 6s (same as `delayMs * (attempt + 1)`).
 */
export const browserTaskRetrySchedule = Schedule.fromDelays(
	Duration.millis(BROWSER_TASK_RETRY_DELAY_MS * 1),
	Duration.millis(BROWSER_TASK_RETRY_DELAY_MS * 2),
)

export class BrowserService extends Context.Tag("BrowserService")<
	BrowserService,
	{
		readonly enabled: boolean
		readonly runTask: (
			input: BrowserTaskInput,
			options?: BrowserTaskRunOptions,
		) => Effect.Effect<BrowserTaskResult, BrowserError>
	}
>() {}
