import type { Env } from "@amby/env"
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk"
import { z } from "zod"
import {
	AMBY_VOICE_AGENT_NAME,
	PLAYGROUND_TOKEN_TTL,
	type VoiceDispatchMetadata,
	type VoiceMessageMetadata,
} from "./config"

export interface LiveKitConfig {
	serverUrl: string
	apiKey: string
	apiSecret: string
}

export interface VoiceProviderConfig {
	openAIApiKey: string
	cartesiaApiKey: string
}

const requireValue = (value: string, name: string) => {
	const trimmed = value.trim()
	if (!trimmed) throw new Error(`${name} is required for voice.`)
	return trimmed
}

export const getLiveKitConfig = (
	env: Pick<Env, "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET">,
): LiveKitConfig => ({
	serverUrl: requireValue(env.LIVEKIT_URL, "LIVEKIT_URL"),
	apiKey: requireValue(env.LIVEKIT_API_KEY, "LIVEKIT_API_KEY"),
	apiSecret: requireValue(env.LIVEKIT_API_SECRET, "LIVEKIT_API_SECRET"),
})

export const getVoiceProviderConfig = (
	env: Pick<Env, "OPENAI_API_KEY" | "CARTESIA_API_KEY">,
): VoiceProviderConfig => ({
	openAIApiKey: requireValue(env.OPENAI_API_KEY, "OPENAI_API_KEY"),
	cartesiaApiKey: requireValue(env.CARTESIA_API_KEY, "CARTESIA_API_KEY"),
})

export const createPlaygroundToken = async ({
	livekit,
	roomName,
	participantIdentity,
	participantName,
	dispatchMetadata,
}: {
	livekit: LiveKitConfig
	roomName: string
	participantIdentity: string
	participantName: string
	dispatchMetadata: VoiceDispatchMetadata
}) => {
	const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
		identity: participantIdentity,
		name: participantName,
		ttl: PLAYGROUND_TOKEN_TTL,
		attributes: { source: dispatchMetadata.source },
	})

	token.addGrant({
		roomJoin: true,
		room: roomName,
		canPublish: true,
		canPublishData: true,
		canSubscribe: true,
	})
	token.roomConfig = new RoomConfiguration({
		name: roomName,
		agents: [
			new RoomAgentDispatch({
				agentName: AMBY_VOICE_AGENT_NAME,
				metadata: JSON.stringify(dispatchMetadata),
			}),
		],
	})

	return token.toJwt()
}

const VoiceDispatchMetadataSchema = z.object({
	userId: z.string(),
	conversationId: z.string(),
	source: z.literal("playground"),
})

export const parseDispatchMetadata = (rawMetadata: string | undefined): VoiceDispatchMetadata => {
	if (!rawMetadata) throw new Error("Missing LiveKit dispatch metadata.")

	let parsed: unknown
	try {
		parsed = JSON.parse(rawMetadata)
	} catch {
		throw new Error("Invalid JSON in LiveKit dispatch metadata.")
	}

	return VoiceDispatchMetadataSchema.parse(parsed)
}

export const buildVoiceMessageMetadata = ({
	source,
	roomName,
	participantIdentity,
}: {
	source: VoiceDispatchMetadata["source"]
	roomName: string
	participantIdentity: string
}): VoiceMessageMetadata => ({
	voice: {
		source,
		roomName,
		participantIdentity,
	},
})
