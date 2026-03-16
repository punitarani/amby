import { createComputerTools, SandboxService } from "@amby/computer"
import { DbService, desc, eq, schema } from "@amby/db"
import {
	buildMemoriesText,
	createMemoryTools,
	deduplicateMemories,
	MemoryService,
} from "@amby/memory"
import { ModelService } from "@amby/models"
import { generateText, stepCountIs, streamText } from "ai"
import { Context, Effect, Layer } from "effect"
import { AgentError } from "./errors"

export type StreamPart =
	| { type: "text-delta"; text: string }
	| { type: "tool-call"; toolName: string; args: Record<string, unknown> }
	| { type: "tool-result"; toolName: string; result: unknown }

import { SYSTEM_PROMPT } from "./prompts/system"
import { createJobTools } from "./tools/messaging"

export class AgentService extends Context.Tag("AgentService")<
	AgentService,
	{
		readonly handleMessage: (
			conversationId: string,
			content: string,
		) => Effect.Effect<string, AgentError>
		readonly streamMessage: (
			conversationId: string,
			content: string,
			onPart: (part: StreamPart) => void,
		) => Effect.Effect<string, AgentError>
		readonly ensureConversation: (channelType?: string) => Effect.Effect<string, AgentError>
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
			const model = models.getModel()

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
			) => query((d) => d.insert(schema.messages).values({ conversationId, role, content }))

			return {
				handleMessage: (conversationId, content) =>
					Effect.gen(function* () {
						const profile = yield* memory.getProfile(userId)
						const deduped = deduplicateMemories(profile.static, profile.dynamic)
						const memoryContext = buildMemoriesText(deduped)

						const history = yield* loadHistory(conversationId)

						const tools = {
							...createMemoryTools(memory, userId),
							...computer.tools,
							...createJobTools(db, userId),
						}

						const systemPrompt = memoryContext
							? `${SYSTEM_PROMPT}\n\n# User Memory Context\n${memoryContext}`
							: SYSTEM_PROMPT

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

						yield* saveMessage(conversationId, "user", content)
						yield* saveMessage(conversationId, "assistant", result.text)

						return result.text
					}).pipe(
						Effect.mapError((e) =>
							e instanceof AgentError
								? e
								: new AgentError({ message: "Agent message handling failed", cause: e }),
						),
					),

				streamMessage: (conversationId, content, onPart) =>
					Effect.gen(function* () {
						const profile = yield* memory.getProfile(userId)
						const deduped = deduplicateMemories(profile.static, profile.dynamic)
						const memoryContext = buildMemoriesText(deduped)

						const history = yield* loadHistory(conversationId)

						const tools = {
							...createMemoryTools(memory, userId),
							...computer.tools,
							...createJobTools(db, userId),
						}

						const systemPrompt = memoryContext
							? `${SYSTEM_PROMPT}\n\n# User Memory Context\n${memoryContext}`
							: SYSTEM_PROMPT

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
					Effect.gen(function* () {
						const existing = yield* query((d) =>
							d
								.select({ id: schema.conversations.id })
								.from(schema.conversations)
								.where(eq(schema.conversations.userId, userId))
								.orderBy(desc(schema.conversations.updatedAt))
								.limit(1),
						)

						if (existing[0]) return existing[0].id

						const rows = yield* query((d) =>
							d
								.insert(schema.conversations)
								.values({ userId, channelType })
								.returning({ id: schema.conversations.id }),
						)
						const row = rows[0]
						if (!row) {
							return yield* Effect.fail(
								new AgentError({ message: "Failed to create conversation" }),
							)
						}
						return row.id
					}).pipe(
						Effect.mapError(
							(e) => new AgentError({ message: "Failed to ensure conversation", cause: e }),
						),
					),

				shutdown: () =>
					Effect.gen(function* () {
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
