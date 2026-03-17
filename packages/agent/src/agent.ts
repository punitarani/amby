import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { ChannelType } from "@amby/channels"
import { createComputerTools, createCuaTools, SandboxService } from "@amby/computer"
import { DbService, desc, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import {
	buildMemoriesText,
	createMemoryTools,
	deduplicateMemories,
	MemoryService,
} from "@amby/memory"
import { ModelService } from "@amby/models"
import { withTracing } from "@posthog/ai"
import { generateText, stepCountIs, streamText } from "ai"
import { Context, Effect, Layer } from "effect"
import { PostHog } from "posthog-node"
import { AgentError } from "./errors"

export type StreamPart =
	| { type: "text-delta"; text: string }
	| { type: "tool-call"; toolName: string; args: Record<string, unknown> }
	| { type: "tool-result"; toolName: string; result: unknown }

import { buildSystemPrompt, CUA_PROMPT } from "./prompts/system"
import { createJobTools, createReplyTools, type ReplyFn } from "./tools/messaging"

export class AgentService extends Context.Tag("AgentService")<
	AgentService,
	{
		readonly handleMessage: (
			conversationId: string,
			content: string,
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
		) => Effect.Effect<string, AgentError>
		readonly handleBatchedMessages: (
			conversationId: string,
			messages: string[],
			metadata?: Record<string, unknown>,
			onReply?: ReplyFn,
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
			const env = yield* EnvService
			const enableCua = env.ENABLE_CUA
			const phClient = new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST })
			const baseModel = models.getModel()
			const model = withTracing(baseModel as LanguageModelV3, phClient, {
				posthogDistinctId: userId,
			})

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

					const tools = {
						...createMemoryTools(memory, userId),
						...computer.tools,
						...createJobTools(db, userId, userTimezone),
						...(onReply ? createReplyTools(onReply) : {}),
						...(enableCua
							? createCuaTools(sandbox, userId, conversationId, computer.getSandbox).tools
							: {}),
					}

					const basePrompt = enableCua
						? `${buildSystemPrompt(formatted, userTimezone)}\n\n${CUA_PROMPT}`
						: buildSystemPrompt(formatted, userTimezone)
					const systemPrompt = memoryContext
						? `${basePrompt}\n\n# User Memory Context\n${memoryContext}`
						: basePrompt

					return { tools, systemPrompt, history }
				})

			return {
				handleMessage: (conversationId, content, metadata, onReply) =>
					Effect.gen(function* () {
						const { tools, systemPrompt, history } = yield* prepareContext(conversationId, onReply)

						const result = yield* Effect.tryPromise({
							try: () =>
								generateText({
									model,
									system: systemPrompt,
									messages: [...history, { role: "user" as const, content }],
									tools,
									stopWhen: stepCountIs(10),
								}),
							catch: (cause) => new AgentError({ message: "Failed to generate response", cause }),
						})

						yield* saveMessage(conversationId, "user", content, metadata)
						yield* saveMessage(conversationId, "assistant", result.text)

						return result.text
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent message handling failed", cause: e }),
						),
					),

				handleBatchedMessages: (conversationId, messages, metadata, onReply) =>
					Effect.gen(function* () {
						const { tools, systemPrompt, history } = yield* prepareContext(conversationId, onReply)

						// Each batched message becomes a separate user turn
						const userMessages = messages.map((content) => ({
							role: "user" as const,
							content,
						}))

						const result = yield* Effect.tryPromise({
							try: () =>
								generateText({
									model,
									system: systemPrompt,
									messages: [...history, ...userMessages],
									tools,
									stopWhen: stepCountIs(10),
								}),
							catch: (cause) => new AgentError({ message: "Failed to generate response", cause }),
						})

						// Save each message individually for accurate history
						for (const content of messages) {
							yield* saveMessage(conversationId, "user", content, metadata)
						}
						yield* saveMessage(conversationId, "assistant", result.text)

						return result.text
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent batched message handling failed", cause: e }),
						),
					),

				streamMessage: (conversationId, content, onPart) =>
					Effect.gen(function* () {
						const { tools, systemPrompt, history } = yield* prepareContext(conversationId)

						const result = yield* Effect.tryPromise({
							try: async () => {
								const stream = streamText({
									model,
									system: systemPrompt,
									messages: [...history, { role: "user" as const, content }],
									tools,
									stopWhen: stepCountIs(10),
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
											onPart({ type: "tool-result", toolName: part.toolName, result: part.output })
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
					}).pipe(
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
						yield* Effect.tryPromise({
							try: () => phClient.shutdown(),
							catch: (cause) => new AgentError({ message: "Failed to shutdown PostHog", cause }),
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
