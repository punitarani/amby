import type { BrowserService } from "@amby/browser"
import { Effect } from "effect"
import type { TraceWriter } from "../ledger"
import type { ExecutionTask, ExecutionTaskResult } from "../../types/execution"

export async function runBrowserSpecialist(params: {
	task: ExecutionTask
	browser: import("effect").Context.Tag.Service<typeof BrowserService>
	trace: TraceWriter
}) {
	if (params.task.input.kind !== "browser") {
		throw new Error("Browser runner received a non-browser task input.")
	}

	const startedAt = Date.now()
	const browserResult = await Effect.runPromise(params.browser.runTask(params.task.input.task))

	const result: ExecutionTaskResult = {
		taskId: params.task.id,
		rootTaskId: params.task.rootTaskId,
		parentTaskId: params.task.parentTaskId,
		depth: params.task.depth,
		specialist: params.task.specialist,
		status: browserResult.status,
		summary: browserResult.summary,
		data: browserResult.output,
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
