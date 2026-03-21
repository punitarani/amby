import type { ChannelType } from "@amby/channels"
import { createComputerTools, createCuaTools, SandboxService, TaskSupervisor } from "@amby/computer"
import { ConnectorsService, createConnectorManagementTools } from "@amby/connectors"
import { DbService, desc, eq, schema } from "@amby/db"
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

import { buildSystemPrompt, CUA_PROMPT } from "./prompts/system"
import { createSubagentTools } from "./subagents/spawner"
import { buildToolGroups } from "./subagents/tool-groups"
import { createCodexAuthTools } from "./tools/codex-auth"
import { createSandboxDelegationTools } from "./tools/delegation"
import { createJobTools, createReplyTools, type ReplyFn } from "./tools/messaging"
import { extractToolUserMessages } from "./utils/extract-tool-user-messages"

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
		readonly ensureConversation: (channelType?: ChannelType) => Effect.Effect<string, AgentError>
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

			const loadHistory = (conversationId: string) =>
				query((d) =>
					d
						.select({ role: schema.messages.role, content: schema.messages.content })
						.from(schema.messages)
						.where(eq(schema.messages.conversationId, conversationId))
						.orderBy(desc(schema.messages.createdAt))
						.limit(20),
				).pipe(
					Effect.map((rows) =>
						rows
							.reverse()
							.filter(
								(r): r is { role: "user" | "assistant"; content: string } =>
									r.role === "user" || r.role === "assistant",
							),
					),
				)

			const saveMessage = (
				conversationId: string,
				role: "user" | "assistant" | "system" | "tool",
				content: string,
				metadata?: Record<string, unknown>,
			) =>
				query((d) => d.insert(schema.messages).values({ conversationId, role, content, metadata }))

			const maybeSaveAssistantMessage = (conversationId: string, content: string) =>
				content.trim() ? saveMessage(conversationId, "assistant", content) : Effect.void

			const prepareContext = (conversationId: string, onReply?: ReplyFn) =>
				Effect.gen(function* () {
					const userRow = yield* query((d) =>
						d
							.select({ timezone: schema.users.timezone })
							.from(schema.users)
							.where(eq(schema.users.id, userId))
							.limit(1),
					)
					const userTimezone = userRow[0]?.timezone ?? "UTC"

					const formatted = new Intl.DateTimeFormat("en-US", {
						timeZone: userTimezone,
						dateStyle: "full",
						timeStyle: "long",
					}).format(new Date())

					const profile = yield* memory.getProfile(userId)
					const deduped = deduplicateMemories(profile.static, profile.dynamic)
					const memoryContext = buildMemoriesText(deduped)

					const history = yield* loadHistory(conversationId)

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
					const systemPrompt = memoryContext
						? `${basePrompt}\n\n# User Memory Context\n${memoryContext}`
						: basePrompt

					const sharedPromptContext = [
						memoryContext ? `# User Memory Context\n${memoryContext}` : "",
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
					// Delegation-heavy turns, especially connected-app work, need extra
					// roundtrips on top of the base agent steps.
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
			}: {
				conversationId: string
				mode: Extract<TraceRequestMode, "message" | "batched-message">
				requestMessages: ReadonlyArray<{ role: "user"; content: string }>
				metadata?: Record<string, unknown>
				onReply?: ReplyFn
				onTextDelta?: (text: string) => void
			}) =>
				withTelemetryFlush(
					Effect.gen(function* () {
						const { tools, systemPrompt, history, sharedPromptContext, toolGroups } =
							yield* prepareContext(conversationId, onReply)
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
						const agent = createOrchestrator(
							systemPrompt,
							{ ...delegationTools, ...tools } as ToolSet,
							"amby.orchestrator.generate",
							orchestratorMetadata,
						)

						const result = yield* Effect.tryPromise({
							try: async () => {
								if (onTextDelta) {
									const stream = await agent.stream({
										messages: [...history, ...requestMessages],
									})
									for await (const part of stream.fullStream) {
										if (part.type === "text-delta") {
											onTextDelta(part.text)
										}
									}
									const [text, toolResults] = await Promise.all([stream.text, stream.toolResults])
									return { text, toolResults }
								}
								return await agent.generate({
									messages: [...history, ...requestMessages],
								})
							},
							catch: (cause) => new AgentError({ message: "Failed to generate response", cause }),
						})
						const toolUserMessages = onReply
							? extractToolUserMessages(result.toolResults)
							: undefined
						if (toolUserMessages && onReply) {
							yield* sendToolUserMessages(toolUserMessages, onReply)
						}
						const finalText = toolUserMessages ? "" : result.text

						for (const message of requestMessages) {
							yield* saveMessage(conversationId, "user", message.content, metadata)
						}
						yield* maybeSaveAssistantMessage(conversationId, finalText)

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
								: new AgentError({ message: "Agent batched message handling failed", cause: e }),
						),
					),

				streamMessage: (conversationId, content, onPart) =>
					withTelemetryFlush(
						Effect.gen(function* () {
							const { tools, systemPrompt, history, sharedPromptContext, toolGroups } =
								yield* prepareContext(conversationId)
							const requestTraceMetadata = buildRequestTraceMetadata({
								conversationId,
								requestMode: "stream-message",
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
							const agent = createOrchestrator(
								systemPrompt,
								{ ...delegationTools, ...tools } as ToolSet,
								"amby.orchestrator.stream",
								orchestratorMetadata,
							)

							const result = yield* Effect.tryPromise({
								try: async () => {
									const stream = await agent.stream({
										messages: [...history, { role: "user" as const, content }],
									})

									for await (const part of stream.fullStream) {
										switch (part.type) {
											case "text-delta":
												onPart({ type: "text-delta", text: part.text })
												break
											case "tool-call":
												onPart({
													type: "tool-call",
													toolName: part.toolName,
													args: part.input as Record<string, unknown>,
												})
												break
											case "tool-result":
												onPart({
													type: "tool-result",
													toolName: part.toolName,
													result: part.output,
												})
												break
										}
									}

									return await stream.text
								},
								catch: (cause) => new AgentError({ message: "Failed to stream response", cause }),
							})

							yield* saveMessage(conversationId, "user", content)
							yield* saveMessage(conversationId, "assistant", result)

							return result
						}),
					).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent stream handling failed", cause: e }),
						),
					),

				ensureConversation: (channelType = "cli") =>
					query((d) =>
						d.transaction(async (tx) => {
							const existing = await tx
								.select({ id: schema.conversations.id })
								.from(schema.conversations)
								.where(eq(schema.conversations.userId, userId))
								.orderBy(desc(schema.conversations.updatedAt))
								.limit(1)

							if (existing[0]) return existing[0].id

							const rows = await tx
								.insert(schema.conversations)
								.values({ userId, channelType })
								.returning({ id: schema.conversations.id })

							const row = rows[0]
							if (!row) throw new Error("Failed to create conversation")
							return row.id
						}),
					).pipe(
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
