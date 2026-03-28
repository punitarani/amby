import type { AttachmentService } from "@amby/attachments"
import { sanitizeFilename } from "@amby/attachments"
import type { TaskSupervisor } from "@amby/computer"
import { Effect } from "effect"
import type { ExecutionTask, ExecutionTaskResult } from "../../types/execution"
import type { RunWriter } from "../ledger"

function readCurrentAttachments(metadata?: Record<string, unknown>) {
	const value = metadata?.currentAttachments
	if (!Array.isArray(value)) return []
	return value
		.filter(
			(item): item is { id: string; filename?: string | null; title?: string | null } =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as { id?: unknown }).id === "string",
		)
		.map((item) => ({
			id: item.id,
			filename: sanitizeFilename(item.filename || item.title || `${item.id}.bin`),
		}))
}

export async function runBackgroundSpecialist(params: {
	task: ExecutionTask
	supervisor: import("effect").Context.Tag.Service<typeof TaskSupervisor>
	attachments: import("effect").Context.Tag.Service<typeof AttachmentService>
	userId: string
	conversationId: string
	threadId?: string
	requestMetadata?: Record<string, unknown>
	trace: RunWriter
}) {
	if (params.task.input.kind !== "background") {
		throw new Error("Background runner received a non-background task input.")
	}

	const attachmentDownloads = await Promise.all(
		readCurrentAttachments(params.requestMetadata).map(async (attachment) => ({
			attachmentId: attachment.id,
			filename: attachment.filename,
			url: await Effect.runPromise(params.attachments.buildSignedDownloadUrl(attachment.id)),
		})),
	)

	const started = await Effect.runPromise(
		params.supervisor.startTask({
			taskId: params.task.id,
			userId: params.userId,
			prompt: params.task.input.prompt,
			instructions: params.task.input.instructions,
			needsBrowser: params.task.input.needsBrowser,
			conversationId: params.conversationId,
			threadId: params.threadId,
			traceId: params.trace.runId,
			parentTaskId: params.task.parentTaskId,
			rootTaskId: params.task.rootTaskId,
			specialist: params.task.specialist,
			runnerKind: params.task.runnerKind,
			input: {
				task: params.task.input,
				inputBindings: params.task.inputBindings,
				resourceLocks: params.task.resourceLocks,
			},
			metadata: {
				depth: params.task.depth,
				spawnedBySpecialist: params.task.spawnedBySpecialist ?? null,
				requiresConfirmation: params.task.requiresConfirmation,
				requiresValidation: params.task.requiresValidation,
			},
			attachmentDownloads,
			confirmationState: params.task.requiresConfirmation ? "required" : "not_required",
		}),
	)

	const result: ExecutionTaskResult = {
		taskId: params.task.id,
		rootTaskId: params.task.rootTaskId,
		parentTaskId: params.task.parentTaskId,
		depth: params.task.depth,
		specialist: params.task.specialist,
		status: "completed",
		summary: "Background task started.",
		traceRef: { traceId: params.trace.runId },
		backgroundRef: {
			taskId: started.taskId,
			traceId: params.trace.runId,
		},
		data: {
			status: started.status,
		},
	}

	return {
		result,
		toolEvents: [
			{
				kind: "tool_result" as const,
				payload: {
					toolName: "background_handoff",
					output: {
						taskId: started.taskId,
						status: started.status,
					},
				},
			},
		],
	}
}
