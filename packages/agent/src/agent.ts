/**
 * AgentService — thin facade over ConversationEngine.
 *
 * This file preserves the original AgentService interface for backward compat.
 * The real orchestration logic lives in conversation/engine.ts.
 * As the migration completes, callers should use ConversationEngine directly.
 */
import { BrowserService } from "@amby/browser"
import type { Platform } from "@amby/channels"
import { createComputerTools, createCuaTools, SandboxService, TaskSupervisor } from "@amby/computer"
import { ConnectorsService } from "@amby/connectors"
import { DbService, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { createMemoryTools, MemoryService } from "@amby/memory"
import type { ToolSet } from "ai"
import { Context, Effect, Layer } from "effect"
import { prepareConversationContext } from "./context/builder"
import { type ConversationEngineConfig, handleTurn, type ReplyFn } from "./conversation/engine"
import { AgentError } from "./errors"
import type { ToolGroups } from "./execution/registry"
import { HIGH_INTELLIGENCE_MODEL_ID, ModelService } from "./models"
import { resolveThread } from "./router"
import {
	synopsisCurrentThreadIfOverflowsAfterSave,
	synopsisPreviousThreadIfDormantSwitch,
} from "./synopsis"
import { initializeTelemetry, shutdownTelemetry, withTelemetryFlush } from "./telemetry"
import { createCodexAuthTools } from "./tools/codex-auth"
import { createJobTools } from "./tools/messaging"
import type { AgentRunResult, StreamPart } from "./types/agent"

export class AgentService extends Context.Tag("AgentService")<
	AgentService,
	{
		readonly handleMessage: (
			conversationId: string,
			content: string,
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
			onTextDelta?: (text: string) => void,
		) => Effect.Effect<AgentRunResult, AgentError>
		readonly handleBatchedMessages: (
			conversationId: string,
			messages: string[],
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
			onTextDelta?: (text: string) => void,
		) => Effect.Effect<AgentRunResult, AgentError>
		readonly streamMessage: (
			conversationId: string,
			content: string,
			onPart: (part: StreamPart) => void,
		) => Effect.Effect<AgentRunResult, AgentError>
		readonly ensureConversation: (
			platform: Platform,
			externalConversationKey: string,
			workspaceKey?: string,
		) => Effect.Effect<string, AgentError>
		readonly shutdown: () => Effect.Effect<void, AgentError>
	}
>() {}

export const makeAgentServiceLive = (userId: string) =>
	Layer.effect(
		AgentService,
		Effect.gen(function* () {
			const { db, query } = yield* DbService
			const models = yield* ModelService
			const memory = yield* MemoryService
			const sandbox = yield* SandboxService
			const browserService = yield* BrowserService
			const taskSupervisor = yield* TaskSupervisor
			const connectors = yield* ConnectorsService
			const env = yield* EnvService
			initializeTelemetry({
				apiKey: env.BRAINTRUST_API_KEY,
				projectId: env.BRAINTRUST_PROJECT_ID,
			})
			const computer = createComputerTools(sandbox, userId)

			// Build tool groups from current direct imports
			// (will be replaced by plugin registry in Unit 11)
			const buildToolGroups = (prepared: { userTimezone: string }): ToolGroups => {
				const memoryTools = createMemoryTools(memory, userId)
				const settingsTools = {
					...createJobTools(db, userId, prepared.userTimezone),
					...(sandbox.enabled ? createCodexAuthTools(taskSupervisor, userId) : {}),
				}
				const cuaEnabled = env.ENABLE_CUA && sandbox.enabled
				const cuaTools = cuaEnabled
					? createCuaTools(sandbox, userId, "", computer.getSandbox).tools
					: undefined

				let integrationTools: ToolSet | undefined
				// Integration tools are resolved per-turn, not here

				return {
					"memory-read": { search_memories: memoryTools.search_memories },
					"memory-write": { save_memory: memoryTools.save_memory },
					"sandbox-read": computer.readTools,
					"sandbox-write": computer.writeTools,
					settings: settingsTools as ToolSet,
					cua: cuaTools as ToolSet | undefined,
					integration: integrationTools,
				}
			}

			const makeEngineConfig = (): ConversationEngineConfig => ({
				userId,
				defaultModelId: models.defaultModelId,
				highReasoningModelId: HIGH_INTELLIGENCE_MODEL_ID,
				getModel: models.getModel,
				environment: env.NODE_ENV,
				runtime: {
					sandboxEnabled: sandbox.enabled,
					cuaEnabled: env.ENABLE_CUA && sandbox.enabled,
					integrationEnabled: connectors.isEnabled(),
					browserEnabled: browserService.enabled,
				},
				toolGroups: buildToolGroups({ userTimezone: "UTC" }),
				query,
				db,
				prepareContext: prepareConversationContext,
				resolveThread,
				synopsisPreviousThreadIfDormantSwitch,
				synopsisCurrentThreadIfOverflowsAfterSave,
				browser: browserService,
				supervisor: taskSupervisor,
				schema,
			})

			const runTurn = (params: {
				conversationId: string
				mode: "message" | "batched-message" | "stream-message"
				requestMessages: ReadonlyArray<{ role: "user"; content: string }>
				metadata?: Record<string, unknown>
				onReply?: ReplyFn
				onTextDelta?: (text: string) => void
				onPart?: (part: StreamPart) => void
			}) => withTelemetryFlush(handleTurn(makeEngineConfig(), params))

			return {
				handleMessage: (conversationId, content, metadata, onReply, onTextDelta) =>
					runTurn({
						conversationId,
						mode: "message",
						requestMessages: [{ role: "user", content }],
						metadata,
						onReply,
						onTextDelta,
					}),

				handleBatchedMessages: (conversationId, messages, metadata, onReply, onTextDelta) =>
					runTurn({
						conversationId,
						mode: "batched-message",
						requestMessages: messages.map((content) => ({ role: "user" as const, content })),
						metadata,
						onReply,
						onTextDelta,
					}),

				streamMessage: (conversationId, content, onPart) =>
					runTurn({
						conversationId,
						mode: "stream-message",
						requestMessages: [{ role: "user", content }],
						onPart,
					}),

				ensureConversation: (platform, externalConversationKey, workspaceKey) =>
					query((database) =>
						database
							.insert(schema.conversations)
							.values({
								userId,
								platform,
								externalConversationKey,
								workspaceKey: workspaceKey ?? "",
							})
							.onConflictDoUpdate({
								target: [
									schema.conversations.userId,
									schema.conversations.platform,
									schema.conversations.workspaceKey,
									schema.conversations.externalConversationKey,
								],
								set: { updatedAt: new Date() },
							})
							.returning({ id: schema.conversations.id }),
					).pipe(
						Effect.map((rows) => {
							const row = rows[0]
							if (!row) throw new Error("Failed to ensure conversation")
							return row.id
						}),
						Effect.mapError(
							(cause) =>
								new AgentError({
									message: cause instanceof Error ? cause.message : "Failed to ensure conversation",
									cause,
								}),
						),
					),

				shutdown: () =>
					Effect.gen(function* () {
						const instance = computer.getSandbox()
						if (instance) {
							yield* sandbox.stop(instance).pipe(Effect.catchAll(() => Effect.void))
						}
						yield* taskSupervisor.shutdown()
						yield* Effect.tryPromise(() => shutdownTelemetry()).pipe(
							Effect.catchAll(() => Effect.void),
						)
					}).pipe(
						Effect.mapError(
							(cause) => new AgentError({ message: "Failed to shut down agent", cause }),
						),
					),
			}
		}),
	)
