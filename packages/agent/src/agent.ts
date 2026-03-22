import type { Platform } from "@amby/channels"
import { createComputerTools, createCuaTools, SandboxService, TaskSupervisor } from "@amby/computer"
import { ConnectorsService, createConnectorManagementTools } from "@amby/connectors"
import { DbService, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import {
	buildMemoriesText,
	createMemoryTools,
	deduplicateMemories,
	MemoryService,
} from "@amby/memory"
import { ModelService } from "@amby/models"
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai"
import { Context, Effect, Layer } from "effect"
import { AgentError } from "./errors"
import {
	type AgentConfig,
	type AgentTraceMetadata,
	buildRequestTraceMetadata,
	createTelemetrySettings,
	initializeTelemetry,
	shutdownTelemetry,
	type TraceRequestMode,
	withTelemetryFlush,
} from "./telemetry"

export type StreamPart =
	| { type: "text-delta"; text: string }
	| { type: "tool-call"; toolName: string; args: Record<string, unknown> }
	| { type: "tool-result"; toolName: string; result: unknown }

const ORCHESTRATOR_MAX_STEPS = 14

import {
	formatArtifactRecap,
	loadOtherThreadSummaries,
	loadThreadArtifacts,
	loadThreadTail,
} from "./context"
import { buildSystemPrompt, CUA_PROMPT } from "./prompts/system"
import { type ResolveThreadResult, resolveThread } from "./router"
import { createSubagentTools } from "./subagents/spawner"
import { buildToolGroups } from "./subagents/tool-groups"
import {
	synopsisCurrentThreadIfOverflowsAfterSave,
	synopsisPreviousThreadIfDormantSwitch,
} from "./synopsis"
import { createCodexAuthTools } from "./tools/codex-auth"
import { createSandboxDelegationTools } from "./tools/delegation"
import { createJobTools, createReplyTools, type ReplyFn } from "./tools/messaging"
import { persistExecutionTrace } from "./traces"
import { extractToolUserMessages } from "./utils/extract-tool-user-messages"

function buildThreadMeta(threadCtx: ResolveThreadResult) {
	return {
		threadId: threadCtx.threadId,
		router: {
			action: threadCtx.decision.action,
			source: threadCtx.decision.source,
		},
	}
}

export class AgentService extends Context.Tag("AgentService")<
	AgentService,
	{
		readonly handleMessage: (
			conversationId: string,
			content: string,
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
			onTextDelta?: (text: string) => void,
		) => Effect.Effect<string, AgentError>
		readonly handleBatchedMessages: (
			conversationId: string,
			messages: string[],
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
			onTextDelta?: (text: string) => void,
		) => Effect.Effect<string, AgentError>
		readonly streamMessage: (
			conversationId: string,
			content: string,
			onPart: (part: StreamPart) => void,
		) => Effect.Effect<string, AgentError>
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
			const taskSupervisor = yield* TaskSupervisor
			const connectors = yield* ConnectorsService
			const env = yield* EnvService
			initializeTelemetry({
				apiKey: env.BRAINTRUST_API_KEY,
				projectId: env.BRAINTRUST_PROJECT_ID,
			})
			const baseModel = models.getModel()
			const agentConfig: AgentConfig = {
				userId,
				modelId: models.defaultModelId,
				cuaEnabled: env.ENABLE_CUA,
			}

			const computer = createComputerTools(sandbox, userId)

			const saveMessage = (
				conversationId: string,
				role: "user" | "assistant",
				content: string,
				opts?: {
					metadata?: Record<string, unknown>
					threadId?: string
				},
			) =>
				query((d) =>
					d
						.insert(schema.messages)
						.values({
							conversationId,
							role,
							content,
							threadId: opts?.threadId,
							metadata: opts?.metadata,
						})
						.returning({ id: schema.messages.id }),
				)

			const maybeSaveAssistantMessage = (
				conversationId: string,
				content: string,
				opts?: {
					threadId?: string
				},
			) =>
				content.trim()
					? saveMessage(conversationId, "assistant", content, opts)
					: Effect.succeed([])

			const prepareContext = (
				conversationId: string,
				threadCtx: ResolveThreadResult,
				onReply?: ReplyFn,
			) =>
				Effect.gen(function* () {
					const [userRow, profile] = yield* Effect.all(
						[
							query((d) =>
								d
									.select({ timezone: schema.users.timezone })
									.from(schema.users)
									.where(eq(schema.users.id, userId))
									.limit(1),
							),
							memory.getProfile(userId),
						],
						{ concurrency: 2 },
					)
					const userTimezone = userRow[0]?.timezone ?? "UTC"

					const formatted = new Intl.DateTimeFormat("en-US", {
						timeZone: userTimezone,
						dateStyle: "full",
						timeStyle: "long",
					}).format(new Date())

					const deduped = deduplicateMemories(profile.static, profile.dynamic)
					const memoryContext = buildMemoriesText(deduped)

					const [threadRow, history, otherThreads, artifactRows] = yield* Effect.all(
						[
							query((d) =>
								d
									.select({
										label: schema.conversationThreads.label,
										synopsis: schema.conversationThreads.synopsis,
									})
									.from(schema.conversationThreads)
									.where(eq(schema.conversationThreads.id, threadCtx.threadId))
									.limit(1),
							),
							loadThreadTail(query, conversationId, threadCtx.threadId),
							loadOtherThreadSummaries(query, conversationId, threadCtx.threadId),
							loadThreadArtifacts(query, conversationId, threadCtx.threadId),
						],
						{ concurrency: 4 },
					)

					const threadLabel = threadRow[0]?.label ?? null
					const threadSynopsis = threadRow[0]?.synopsis?.trim() ?? ""
					const artifactRecap = formatArtifactRecap(artifactRows, threadLabel)

					const threadSynopsisBlock =
						threadCtx.threadWasDormant && threadSynopsis
							? `## Resumed thread synopsis\n${threadSynopsis}`
							: ""

					const memoryTools = createMemoryTools(memory, userId)
					const sandboxTools = sandbox.enabled
						? createSandboxDelegationTools(taskSupervisor, userId, conversationId)
						: undefined
					const codexAuthTools = sandbox.enabled
						? createCodexAuthTools(taskSupervisor, userId)
						: undefined
					const cuaTools = agentConfig.cuaEnabled
						? createCuaTools(sandbox, userId, conversationId, computer.getSandbox).tools
						: undefined
					const connectorManagementTools = connectors.isEnabled()
						? createConnectorManagementTools(connectors, userId)
						: undefined
					const connectorSessionTools = connectors.isEnabled()
						? yield* connectors.getAgentTools(userId).pipe(
								Effect.catchAll((error) =>
									Effect.sync(() => {
										console.error("[Agent] Failed to load Composio tools:", error)
										return undefined
									}),
								),
							)
						: undefined
					const integrationTools =
						connectorManagementTools || connectorSessionTools
							? ({
									...(connectorManagementTools ?? {}),
									...(connectorSessionTools ?? {}),
								} as ToolSet)
							: undefined
					const toolGroups = buildToolGroups(
						memoryTools,
						computer.tools,
						cuaTools,
						integrationTools,
					)

					const basePrompt = agentConfig.cuaEnabled
						? `${buildSystemPrompt(formatted, userTimezone)}\n\n${CUA_PROMPT}`
						: buildSystemPrompt(formatted, userTimezone)

					const contextSections = [otherThreads, threadSynopsisBlock, artifactRecap].filter(Boolean)
					const extraContext = contextSections.join("\n\n")

					const systemPrompt = [
						basePrompt,
						memoryContext ? `# User Memory Context\n${memoryContext}` : "",
						extraContext,
					]
						.filter(Boolean)
						.join("\n\n")

					const sharedPromptContext = [
						memoryContext ? `# User Memory Context\n${memoryContext}` : "",
						extraContext,
						`# Current Date/Time\n${formatted} (${userTimezone})`,
					]
						.filter(Boolean)
						.join("\n\n")

					const { search_memories } = memoryTools
					const tools = {
						search_memories,
						...(sandboxTools ?? {}),
						...(codexAuthTools ?? {}),
						...createJobTools(db, userId, userTimezone),
						...(onReply ? createReplyTools(onReply) : {}),
					}

					return { tools, systemPrompt, history, userTimezone, sharedPromptContext, toolGroups }
				})

			const createOrchestrator = (
				systemPrompt: string,
				tools: ToolSet,
				functionId: "amby.orchestrator.generate" | "amby.orchestrator.stream",
				conversationTraceMetadata: AgentTraceMetadata,
			) =>
				new ToolLoopAgent({
					id: "orchestrator",
					model: baseModel,
					instructions: systemPrompt,
					tools,
					stopWhen: stepCountIs(ORCHESTRATOR_MAX_STEPS),
					experimental_telemetry: createTelemetrySettings({
						functionId,
						metadata: conversationTraceMetadata,
					}),
				})

			const sendToolUserMessages = (toolUserMessages: string[], onReply: ReplyFn) =>
				Effect.tryPromise(async () => {
					for (const message of toolUserMessages) {
						await onReply(message)
					}
				})

			const runGenerateRequest = ({
				conversationId,
				mode,
				requestMessages,
				metadata,
				onReply,
				onTextDelta,
				onPart,
			}: {
				conversationId: string
				mode: TraceRequestMode
				requestMessages: ReadonlyArray<{ role: "user"; content: string }>
				metadata?: Record<string, unknown>
				onReply?: ReplyFn
				onTextDelta?: (text: string) => void
				onPart?: (part: StreamPart) => void
			}) =>
				withTelemetryFlush(
					Effect.gen(function* () {
						const inboundText = requestMessages.map((m) => m.content).join("\n\n")
						const threadCtx = yield* resolveThread(query, conversationId, inboundText, baseModel)

						Effect.runFork(
							synopsisPreviousThreadIfDormantSwitch(query, baseModel, conversationId, threadCtx),
						)

						const { tools, systemPrompt, history, sharedPromptContext, toolGroups } =
							yield* prepareContext(conversationId, threadCtx, onReply)
						const requestTraceMetadata = buildRequestTraceMetadata({
							conversationId,
							requestMode: mode,
							requestMetadata: metadata,
						})
						const delegationTools = createSubagentTools(
							models.getModel,
							toolGroups,
							sharedPromptContext,
							agentConfig,
							requestTraceMetadata,
						)
						const orchestratorMetadata: AgentTraceMetadata = {
							...requestTraceMetadata,
							user_id: agentConfig.userId,
							model_id: agentConfig.modelId,
							cua_enabled: agentConfig.cuaEnabled,
							agent_role: "orchestrator",
							agent_name: "orchestrator",
						}
						const functionId = onPart ? "amby.orchestrator.stream" : "amby.orchestrator.generate"
						const agent = createOrchestrator(
							systemPrompt,
							{ ...delegationTools, ...tools } as ToolSet,
							functionId as "amby.orchestrator.generate" | "amby.orchestrator.stream",
							orchestratorMetadata,
						)

						const messages = [
							...history,
							...requestMessages.map((m) => ({ role: "user" as const, content: m.content })),
						]

						const result = yield* Effect.tryPromise({
							try: async () => {
								if (onPart || onTextDelta) {
									const stream = await agent.stream({ messages })

									for await (const part of stream.fullStream) {
										switch (part.type) {
											case "text-delta":
												if (onTextDelta) onTextDelta(part.text)
												if (onPart) onPart({ type: "text-delta", text: part.text })
												break
											case "tool-call":
												if (onPart) {
													onPart({
														type: "tool-call",
														toolName: part.toolName,
														args: part.input as Record<string, unknown>,
													})
												}
												break
											case "tool-result":
												if (onPart) {
													onPart({
														type: "tool-result",
														toolName: part.toolName,
														result: part.output,
													})
												}
												break
										}
									}

									const [text, toolResults, steps] = await Promise.all([
										stream.text,
										stream.toolResults,
										stream.steps,
									])
									return { text, toolResults, steps }
								}
								return await agent.generate({ messages })
							},
							catch: (cause) =>
								new AgentError({
									message: onPart ? "Failed to stream response" : "Failed to generate response",
									cause,
								}),
						})

						const toolUserMessages = onReply
							? extractToolUserMessages(result.toolResults)
							: undefined
						if (toolUserMessages && onReply) {
							yield* sendToolUserMessages(toolUserMessages, onReply)
						}
						const finalText = toolUserMessages ? "" : result.text

						const threadMeta = buildThreadMeta(threadCtx)
						const userMetadata = metadata ? { ...metadata, ...threadMeta } : threadMeta

						// Persist inbound messages
						for (const message of requestMessages) {
							yield* saveMessage(conversationId, "user", message.content, {
								metadata: userMetadata,
								threadId: threadCtx.threadId,
							})
						}

						// Save assistant message
						const savedRows = yield* maybeSaveAssistantMessage(conversationId, finalText, {
							threadId: threadCtx.threadId,
						})

						// Persist execution traces
						const savedMessageId = savedRows[0]?.id
						if (result.steps?.length) {
							yield* persistExecutionTrace(query, {
								conversationId,
								threadId: threadCtx.threadId,
								messageId: savedMessageId,
								agentName: "orchestrator",
								steps: result.steps,
							})
						}

						Effect.runFork(
							synopsisCurrentThreadIfOverflowsAfterSave(
								query,
								baseModel,
								conversationId,
								threadCtx,
								requestMessages.length + 1,
							),
						)

						return finalText
					}),
				)

			return {
				handleMessage: (conversationId, content, metadata, onReply, onTextDelta) =>
					runGenerateRequest({
						conversationId,
						mode: "message",
						requestMessages: [{ role: "user", content }],
						metadata,
						onReply,
						onTextDelta,
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent message handling failed", cause: e }),
						),
					),

				handleBatchedMessages: (conversationId, messages, metadata, onReply, onTextDelta) =>
					runGenerateRequest({
						conversationId,
						mode: "batched-message",
						requestMessages: messages.map((content) => ({ role: "user" as const, content })),
						metadata,
						onReply,
						onTextDelta,
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({
										message: "Agent batched message handling failed",
										cause: e,
									}),
						),
					),

				streamMessage: (conversationId, content, onPart) =>
					runGenerateRequest({
						conversationId,
						mode: "stream-message",
						requestMessages: [{ role: "user", content }],
						onPart,
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent stream handling failed", cause: e }),
						),
					),

				ensureConversation: (platform, externalConversationKey, workspaceKey) =>
					query((d) =>
						d
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
							(e) =>
								new AgentError({
									message: `Failed to ensure conversation: ${e instanceof Error ? e.message : String(e)}`,
									cause: e,
								}),
						),
					),

				shutdown: () =>
					Effect.gen(function* () {
						yield* taskSupervisor.shutdown()
						yield* Effect.tryPromise({
							try: () => shutdownTelemetry(),
							catch: (cause) => new AgentError({ message: "Failed to shut down telemetry", cause }),
						})
						const instance = computer.getSandbox()
						if (instance) {
							yield* sandbox
								.stop(instance)
								.pipe(
									Effect.mapError(
										(e) => new AgentError({ message: "Failed to stop sandbox", cause: e }),
									),
								)
						}
					}),
			}
		}),
	)
