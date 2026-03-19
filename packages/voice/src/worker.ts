import { ReadableStream } from "node:stream/web"
import { fileURLToPath } from "node:url"
import { AgentService } from "@amby/agent"
import { EnvService } from "@amby/env"
import {
	type APIConnectOptions,
	AutoSubscribe,
	cli,
	DEFAULT_API_CONNECT_OPTIONS,
	defineAgent,
	type JobContext,
	type JobProcess,
	llm,
	voice,
	WorkerOptions,
} from "@livekit/agents"
import * as cartesia from "@livekit/agents-plugin-cartesia"
import * as livekit from "@livekit/agents-plugin-livekit"
import * as openai from "@livekit/agents-plugin-openai"
import * as silero from "@livekit/agents-plugin-silero"
import { Effect } from "effect"
import {
	AMBY_VOICE_AGENT_NAME,
	AMBY_VOICE_GREETING,
	DEFAULT_CARTESIA_TTS_MODEL,
	DEFAULT_CARTESIA_VOICE,
	DEFAULT_OPENAI_STT_MODEL,
	DEFAULT_VOICE_LANGUAGE,
	type VoiceMessageMetadata,
} from "./config"
import { buildVoiceMessageMetadata, getVoiceProviderConfig, parseDispatchMetadata } from "./livekit"
import { makeVoiceAgentRuntime } from "./runtime"

const extractLatestUserText = (chatCtx: llm.ChatContext) => {
	for (let index = chatCtx.items.length - 1; index >= 0; index -= 1) {
		const item = chatCtx.items[index]
		if (item?.type !== "message" || item.role !== "user") continue
		if (typeof item.textContent === "string" && item.textContent.trim()) {
			return item.textContent.trim()
		}
	}

	return undefined
}

class NoopLLM extends llm.LLM {
	override label() {
		return "amby-voice-bridge"
	}

	override get model() {
		return "amby-agent-bridge"
	}

	override chat({
		chatCtx,
		toolCtx,
		connOptions = DEFAULT_API_CONNECT_OPTIONS,
	}: {
		chatCtx: llm.ChatContext
		toolCtx?: llm.ToolContext
		connOptions?: APIConnectOptions
		parallelToolCalls?: boolean
		toolChoice?: llm.ToolChoice
		extraKwargs?: Record<string, unknown>
	}) {
		return new NoopLLMStream(this, { chatCtx, toolCtx, connOptions })
	}
}

class NoopLLMStream extends llm.LLMStream {
	protected override async run() {
		throw new Error(
			"NoopLLM should never be used directly. AmbyVoiceAgent.llmNode must handle replies.",
		)
	}
}

class AmbyVoiceAgent extends voice.Agent {
	constructor(
		private readonly streamReply: (
			content: string,
			onText: (text: string) => void,
			metadata: VoiceMessageMetadata,
		) => Promise<string>,
		private readonly metadata: VoiceMessageMetadata,
	) {
		super({
			instructions: "You are Amby, a voice assistant.",
			// LiveKit requires an LLM to be present before it will run the reply pipeline.
			// Replies still come from the custom llmNode bridge into @amby/agent.
			llm: new NoopLLM(),
		})
	}

	override async llmNode(chatCtx: llm.ChatContext, _toolCtx: unknown, _modelSettings: unknown) {
		const userInput = extractLatestUserText(chatCtx)
		if (!userInput) return null

		let emittedText = false

		return new ReadableStream<string>({
			start: (controller) => {
				void this.streamReply(
					userInput,
					(text) => {
						if (!text) return
						emittedText = true
						controller.enqueue(text)
					},
					this.metadata,
				)
					.then((result) => {
						if (!emittedText && result.trim()) controller.enqueue(result)
						controller.close()
					})
					.catch((error) => controller.error(error))
			},
		})
	}
}

export default defineAgent({
	prewarm: async (proc: JobProcess) => {
		proc.userData.vad = await silero.VAD.load()
	},
	entry: async (ctx: JobContext) => {
		const dispatch = parseDispatchMetadata(ctx.job.metadata)
		const runtime = makeVoiceAgentRuntime(dispatch.userId)
		let disposed = false
		const disposeRuntime = async () => {
			if (disposed) return
			disposed = true
			await runtime.dispose()
		}

		try {
			const { env, agentService } = await runtime.runPromise(
				Effect.gen(function* () {
					const env = yield* EnvService
					const agentService = yield* AgentService
					return { env, agentService }
				}),
			)
			const providers = getVoiceProviderConfig(env)

			await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY)
			const participant = await ctx.waitForParticipant()
			const roomName = ctx.room.name
			if (!roomName) throw new Error("LiveKit room name missing in voice session.")
			if (!participant.identity) {
				throw new Error("LiveKit participant identity missing in voice session.")
			}
			const messageMetadata = buildVoiceMessageMetadata({
				source: dispatch.source,
				roomName,
				participantIdentity: participant.identity,
			})

			ctx.addShutdownCallback(async () => {
				try {
					await runtime.runPromise(agentService.shutdown())
				} finally {
					await disposeRuntime()
				}
			})

			const session = new voice.AgentSession({
				stt: new openai.STT({
					apiKey: providers.openAIApiKey,
					language: DEFAULT_VOICE_LANGUAGE,
					model: DEFAULT_OPENAI_STT_MODEL,
				}),
				tts: new cartesia.TTS({
					apiKey: providers.cartesiaApiKey,
					language: DEFAULT_VOICE_LANGUAGE,
					model: DEFAULT_CARTESIA_TTS_MODEL,
					voice: DEFAULT_CARTESIA_VOICE,
				}),
				vad: ctx.proc.userData.vad as silero.VAD,
				turnDetection: new livekit.turnDetector.MultilingualModel(),
			})

			session.on(voice.AgentSessionEventTypes.Error, (event) => {
				console.error("Voice session error:", event.error)
			})

			await session.start({
				agent: new AmbyVoiceAgent(
					(content, onText, metadata) =>
						runtime.runPromise(
							agentService.streamMessage(
								dispatch.conversationId,
								content,
								(part) => {
									if (part.type === "text-delta") onText(part.text)
								},
								metadata,
							),
						),
					messageMetadata,
				),
				room: ctx.room,
				outputOptions: {
					transcriptionEnabled: true,
				},
			})

			session.say(AMBY_VOICE_GREETING)
		} catch (error) {
			await disposeRuntime()
			throw error
		}
	},
})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	cli.runApp(
		new WorkerOptions({
			agent: fileURLToPath(import.meta.url),
			agentName: AMBY_VOICE_AGENT_NAME,
		}),
	)
}
