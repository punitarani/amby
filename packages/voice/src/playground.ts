import { AgentService } from "@amby/agent"
import { AuthService } from "@amby/auth"
import { EnvService } from "@amby/env"
import { Effect } from "effect"
import { requireFlag } from "./args"
import { AMBY_VOICE_AGENT_NAME } from "./config"
import { createPlaygroundToken, getLiveKitConfig } from "./livekit"
import { makeVoiceAgentRuntime, makeVoiceBaseRuntime } from "./runtime"

const printUsage = () => {
	console.log("Usage: bun run voice:playground -- --email user@example.com --password secret123")
}

const main = async () => {
	if (process.argv.includes("--help")) {
		printUsage()
		return
	}

	const email = requireFlag("--email")
	const password = requireFlag("--password")
	const roomName = `voice-${crypto.randomUUID()}`
	const participantIdentity = `playground-${crypto.randomUUID()}`
	const authRuntime = makeVoiceBaseRuntime()

	try {
		const user = await authRuntime.runPromise(
			Effect.gen(function* () {
				const auth = yield* AuthService
				const result = yield* Effect.tryPromise({
					try: () =>
						auth.api.signInEmail({
							body: { email, password, rememberMe: false },
							headers: new Headers(),
						}),
					catch: (cause) =>
						cause instanceof Error
							? cause
							: new Error(`Failed to authenticate voice user: ${String(cause)}`),
				})

				return result.user
			}),
		)

		const agentRuntime = makeVoiceAgentRuntime(user.id)

		try {
			const bundle = await agentRuntime.runPromise(
				Effect.gen(function* () {
					const env = yield* EnvService
					const agent = yield* AgentService
					const livekit = getLiveKitConfig(env)
					const conversationId = yield* agent.startConversation("voice", {
						source: "playground",
						roomName,
						participantIdentity,
						agentName: AMBY_VOICE_AGENT_NAME,
					})
					const participantToken = yield* Effect.tryPromise({
						try: () =>
							createPlaygroundToken({
								livekit,
								roomName,
								participantIdentity,
								participantName: user.name,
								dispatchMetadata: {
									userId: user.id,
									conversationId,
									source: "playground",
								},
							}),
						catch: (cause) =>
							cause instanceof Error
								? cause
								: new Error(`Failed to create LiveKit token: ${String(cause)}`),
					})

					return {
						serverUrl: livekit.serverUrl,
						roomName,
						participantToken,
						agentName: AMBY_VOICE_AGENT_NAME,
						conversationId,
					}
				}),
			)

			console.log(JSON.stringify(bundle, null, 2))
		} finally {
			await agentRuntime.dispose()
		}
	} finally {
		await authRuntime.dispose()
	}
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	printUsage()
	process.exit(1)
})
