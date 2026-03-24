import type { BrowserService, BrowserTaskResult } from "@amby/browser"
import { Effect } from "effect"
import type { ExecutionTask, ExecutionTaskResult } from "../../types/execution"
import type { TraceWriter } from "../ledger"

function buildBrowserTaskData(browserResult: BrowserTaskResult): ExecutionTaskResult["data"] {
	const hasActions = Array.isArray(browserResult.actions) && browserResult.actions.length > 0
	const page = {
		url: browserResult.page.url,
		title: browserResult.page.title,
	}

	if (!hasActions && browserResult.output !== undefined) {
		return browserResult.output
	}

	return {
		page,
		...(browserResult.output !== undefined ? { output: browserResult.output } : {}),
		...(hasActions ? { actions: browserResult.actions } : {}),
	}
}

function buildBrowserRuntimeData(
	browserResult: BrowserTaskResult,
): Record<string, unknown> | undefined {
	const runtimeData = browserResult.runtimeData ?? {}
	return {
		...runtimeData,
		finalPage: {
			url: browserResult.page.url,
			title: browserResult.page.title,
		},
		...(Array.isArray(browserResult.actions) ? { actions: browserResult.actions } : {}),
	}
}

export async function runBrowserSpecialist(params: {
	task: ExecutionTask
	browser: import("effect").Context.Tag.Service<typeof BrowserService>
	trace: TraceWriter
	onProgress?: (event: {
		phase?: string
		category?: string
		message: string
		level?: number
		stepIndex?: number
		page?: { url: string | null; title: string | null }
		auxiliary?: Record<string, unknown>
	}) => void | Promise<void>
}) {
	if (params.task.input.kind !== "browser") {
		throw new Error("Browser runner received a non-browser task input.")
	}

	const startedAt = Date.now()
	const browserResult = await Effect.runPromise(
		params.browser.runTask(params.task.input.task, {
			onProgress: params.onProgress,
		}),
	)

	const result: ExecutionTaskResult = {
		taskId: params.task.id,
		rootTaskId: params.task.rootTaskId,
		parentTaskId: params.task.parentTaskId,
		depth: params.task.depth,
		specialist: params.task.specialist,
		status: browserResult.status,
		summary: browserResult.summary,
		data: buildBrowserTaskData(browserResult),
		artifacts: browserResult.artifacts,
		issues:
			browserResult.issues?.map((message, index) => ({
				code: `browser_issue_${index + 1}`,
				message,
			})) ?? [],
		metrics: {
			...browserResult.metrics,
			durationMs: browserResult.metrics?.durationMs ?? Date.now() - startedAt,
		},
		runtimeData: buildBrowserRuntimeData(browserResult),
		traceRef: { traceId: params.trace.traceId },
	}

	return {
		result,
		toolEvents: [
			{
				kind: "tool_result" as const,
				payload: {
					toolName: "browser_service",
					output: browserResult,
				},
			},
		],
	}
}
