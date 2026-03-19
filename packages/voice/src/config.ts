export const AMBY_VOICE_AGENT_NAME = "amby-voice"
export const AMBY_VOICE_GREETING = "Hi, I'm Amby. How can I help today?"
export const DEFAULT_OPENAI_STT_MODEL = "whisper-1"
export const DEFAULT_CARTESIA_TTS_MODEL = "sonic-3"
/** Cartesia "British Lady" voice */
export const DEFAULT_CARTESIA_VOICE = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
export const DEFAULT_VOICE_LANGUAGE = "en"
export const PLAYGROUND_TOKEN_TTL = "10m"

/** Milliseconds to wait before emitting a generic filler if no text or tool activity. */
export const VOICE_FILLER_DELAY_MS = 1500

/**
 * Maps tool names to contextual filler phrases spoken before the tool executes.
 * Only delegation/long-running tools are listed — fast tools (search_memories, etc.) are skipped.
 */
export const VOICE_TOOL_FILLERS: Readonly<Record<string, readonly string[]>> = {
	delegate_research: ["let me look into that. ", "checking on that. ", "pulling that up. "],
	delegate_builder: ["on it, working on that now. ", "setting that up. "],
	delegate_planner: ["let me think through this. ", "thinking about the best approach. "],
	delegate_computer: ["let me check the screen. ", "taking a look at that. "],
	delegate_memory_manager: ["noted. "],
	delegate_task: ["kicking that off in the background. might take a bit. "],
}

/** Generic filler phrases used when no tool-specific filler applies. */
export const VOICE_GENERIC_FILLERS: readonly string[] = [
	"one sec. ",
	"on it. ",
	"let me check. ",
	"hang on. ",
]

export interface VoiceDispatchMetadata {
	userId: string
	conversationId: string
	source: "playground"
}

export interface VoiceMessageMetadata extends Record<string, unknown> {
	voice: {
		source: VoiceDispatchMetadata["source"]
		roomName: string
		participantIdentity: string
	}
}
