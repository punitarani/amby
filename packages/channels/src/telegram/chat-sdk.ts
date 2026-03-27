import type { WorkerBindings } from "@amby/env/workers"
import { createMemoryState } from "@chat-adapter/state-memory"
import { createTelegramAdapter } from "@chat-adapter/telegram"
import { Chat } from "chat"
import { Effect, type ManagedRuntime } from "effect"
import type { TelegramFrom } from "./utils"
import { handleCommand, parseTelegramCommand } from "./utils"

export interface ChatSdkDeps {
	// biome-ignore lint/suspicious/noExplicitAny: Runtime type parameters vary by caller; correctness verified at the call site
	makeRuntimeForConsumer(env: WorkerBindings): ManagedRuntime.ManagedRuntime<any, any>
	setTelegramScope(input: {
		component: string
		chatId?: number | null
		from?: TelegramFrom | null
		attributes?: Record<string, string | number | boolean | undefined>
	}): void
	captureException(err: unknown): void
	captureCommandError(command: string, chatId: number, err: unknown): void
}

let _chat: Chat | null = null
let _deps: ChatSdkDeps | null = null

export function getOrCreateChat(env: WorkerBindings, deps: ChatSdkDeps) {
	if (_chat) return { chat: _chat }
	_deps = deps

	const adapter = createTelegramAdapter({
		botToken: env.TELEGRAM_BOT_TOKEN ?? "",
		apiBaseUrl: env.TELEGRAM_API_BASE_URL,
		secretToken: env.TELEGRAM_WEBHOOK_SECRET,
		mode: "webhook",
	})

	// Memory state is sufficient — the DO pipeline handles all session state,
	// debouncing, and retries. Chat SDK state is only used for subscription
	// routing (onNewMention vs onSubscribedMessage) which resets per isolate.
	const state = createMemoryState()

	const chat = new Chat({
		userName: "amby",
		adapters: { telegram: adapter },
		state,
	})

	chat.onNewMention(async (thread, message) => {
		await thread.subscribe()
		await routeIncomingMessage(env, message)
	})

	chat.onSubscribedMessage(async (_thread, message) => {
		if (message.author.isMe) return
		await routeIncomingMessage(env, message)
	})

	_chat = chat
	return { chat }
}

async function routeIncomingMessage(
	env: WorkerBindings,
	message: Parameters<Parameters<Chat["onNewMention"]>[0]>[1],
) {
	if (!_deps) throw new Error("[ChatSDK] getOrCreateChat must be called before routing messages")
	const deps = _deps
	const raw = message.raw as {
		from?: TelegramFrom
		chat: { id: number }
		text?: string
		message_id: number
		date: number
	}
	const from = raw.from
	const chatId = raw.chat.id
	const text = raw.text
	const parsedCommand = parseTelegramCommand(text, env.TELEGRAM_BOT_USERNAME)

	if (!from || !chatId) return

	deps.setTelegramScope({
		component: "chat-sdk.route",
		chatId,
		from,
		attributes: {
			telegram_message_id: raw.message_id,
			has_text: Boolean(text),
			is_command: Boolean(parsedCommand),
		},
	})

	// Commands: handle inline
	if (parsedCommand) {
		const runtime = deps.makeRuntimeForConsumer(env)
		try {
			await runtime.runPromise(
				handleCommand(parsedCommand, from, chatId, {
					sandboxWorkflow: env.SANDBOX_WORKFLOW,
				}).pipe(
					Effect.catchAllCause((cause) =>
						Effect.sync(() => {
							const err = cause.toJSON?.() ?? cause
							deps.captureException(err)
							deps.captureCommandError(parsedCommand.rawText, chatId, err)
						}),
					),
				),
			)
		} finally {
			await runtime.dispose()
		}
		return
	}

	if (!text) return

	// Text messages: route to ConversationSession DO for debouncing
	const doBinding = env.CONVERSATION_SESSION
	if (!doBinding) {
		console.error("[ChatSDK] CONVERSATION_SESSION binding not available")
		return
	}

	try {
		const doId = doBinding.idFromName(String(chatId))
		const stub = doBinding.get(doId)
		await stub.ingestMessage({
			text,
			chatId,
			messageId: raw.message_id,
			date: raw.date,
			from,
		})
	} catch (err) {
		deps.captureException(err)
		console.error(`[ChatSDK] Failed to route message to DO for chat ${chatId}:`, err)
	}
}
