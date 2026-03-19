export const AMBY_VOICE_AGENT_NAME = "amby-voice"
export const AMBY_VOICE_GREETING = "Hi, I'm Amby. How can I help today?"
export const DEFAULT_OPENAI_STT_MODEL = "whisper-1"
export const DEFAULT_CARTESIA_TTS_MODEL = "sonic-3"
export const DEFAULT_CARTESIA_VOICE = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
export const DEFAULT_VOICE_LANGUAGE = "en"
export const PLAYGROUND_TOKEN_TTL = "10m"

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
