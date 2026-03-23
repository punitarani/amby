import { Context, Data, type Effect } from "effect"
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

export interface BrowserTaskResult {
	status: BrowserTaskStatus
	summary: string
	page: BrowserTaskPage
	output?: JsonValue
	actions?: JsonValue[]
	artifacts?: BrowserArtifactRef[]
	issues?: string[]
	metrics?: BrowserTaskMetrics
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

const ACT_HINTS = [
	/\bclick\b/i,
	/\bfill\b/i,
	/\btype\b/i,
	/\bsubmit\b/i,
	/\blog in\b/i,
	/\bsign in\b/i,
	/\badd to cart\b/i,
	/\bcheckout\b/i,
]

export function inferBrowserSideEffectLevel(instruction: string): BrowserTaskSideEffectLevel {
	if (ACT_HINTS.some((pattern) => pattern.test(instruction))) {
		return "soft-write"
	}
	if (READ_HINTS.some((pattern) => pattern.test(instruction))) {
		return "read"
	}
	return "soft-write"
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

export class BrowserService extends Context.Tag("BrowserService")<
	BrowserService,
	{
		readonly enabled: boolean
		readonly runTask: (input: BrowserTaskInput) => Effect.Effect<BrowserTaskResult, BrowserError>
	}
>() {}
