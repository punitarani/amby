import { BrowserService } from "@amby/browser"
import { createComputerTools, createCuaTools, SandboxService, TaskSupervisor } from "@amby/computer"
import { type Platform, type PluginRegistry, PluginRegistryService, TaskStore } from "@amby/core"
import { DbService, schema } from "@amby/db"
import { EnvService } from "@amby/env"
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
import { createTimezoneTools } from "./tools/settings"
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

/**
 * Resolve tool groups from the plugin registry.
 *
 * Each tool provider is mapped to its declared group. The agent's
 * specialist registry uses these groups to select which tools are
 * visible to each specialist.
 */
async function resolveToolGroupsFromRegistry(
	registry: PluginRegistry,
	userId: string,
	conversationId: string,
	threadId: string,
): Promise<ToolGroups> {
	const groups: ToolGroups = {}
	const context = { userId, conversationId, threadId }
	for (const provider of registry.toolProviders) {
		try {
			const tools = await provider.getTools(context)
			if (tools && Object.keys(tools).length > 0) {
				const group = provider.group as keyof ToolGroups
				groups[group] = { ...(groups[group] ?? {}), ...tools } as ToolSet
			}
		} catch (err) {
			console.warn(
				`[agent] Tool provider "${provider.id}" (group: ${provider.group}) failed, skipping:`,
				err instanceof Error ? err.message : String(err),
			)
		}
	}
	return groups
}

export const makeAgentServiceLive = (userId: string) =>
	Layer.effect(
		AgentService,
		Effect.gen(function* () {
			const { db, query } = yield* DbService
			const models = yield* ModelService
			const sandbox = yield* SandboxService
			const browserService = yield* BrowserService
			const taskSupervisor = yield* TaskSupervisor
			const taskStore = yield* TaskStore
			const pluginRegistry = yield* PluginRegistryService
			const env = yield* EnvService
			initializeTelemetry({
				apiKey: env.BRAINTRUST_API_KEY,
				projectId: env.BRAINTRUST_PROJECT_ID,
			})
			const computer = createComputerTools(sandbox, userId)

			const buildToolGroups = async (
				conversationId: string,
				threadId: string,
			): Promise<ToolGroups> => {
				const registryTools = await resolveToolGroupsFromRegistry(
					pluginRegistry,
					userId,
					conversationId,
					threadId,
				)

				// Merge sandbox tools (still directly assembled — these are stateful
				// per-user tools that depend on the SandboxService closure)
				registryTools["sandbox-read"] = {
					...(registryTools["sandbox-read"] ?? {}),
					...computer.readTools,
				}
				registryTools["sandbox-write"] = {
					...(registryTools["sandbox-write"] ?? {}),
					...computer.writeTools,
				}

				// Settings tools: timezone + codex auth
				registryTools.settings = {
					...(registryTools.settings ?? {}),
					...createTimezoneTools(db, userId),
					...(sandbox.enabled ? createCodexAuthTools(taskSupervisor, userId) : {}),
				} as ToolSet

				// CUA tools if enabled
				const cuaEnabled = env.ENABLE_CUA && sandbox.enabled
				if (cuaEnabled) {
					registryTools.cua = createCuaTools(sandbox, userId, conversationId, computer.getSandbox)
						.tools as ToolSet
				}

				return registryTools
			}

			const makeEngineConfig = (conversationId: string): ConversationEngineConfig => ({
				userId,
				defaultModelId: models.defaultModelId,
				highReasoningModelId: HIGH_INTELLIGENCE_MODEL_ID,
				getModel: models.getModel,
				environment: env.NODE_ENV,
				runtime: {
					sandboxEnabled: sandbox.enabled,
					cuaEnabled: env.ENABLE_CUA && sandbox.enabled,
					integrationEnabled: pluginRegistry.toolProviders.some((p) => p.group === "integration"),
					browserEnabled: browserService.enabled,
				},
				buildToolGroups: (threadId: string) => buildToolGroups(conversationId, threadId),
				query,
				db,
				taskStore,
				pluginRegistry,
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
			}) => withTelemetryFlush(handleTurn(makeEngineConfig(params.conversationId), params))

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
