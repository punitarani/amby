# Voice Architecture

`@amby/voice` is a thin LiveKit transport layer over `@amby/agent`.

Voice owns realtime audio I/O, Better Auth-gated Playground access, and LiveKit worker bootstrap. `@amby/agent`
still owns reasoning, tools, memory, persistence, and sandbox execution.

## Flow

1. `voice:create-user` creates a real Better Auth user for local testing.
2. `voice:playground` signs that user in, creates a fresh `"voice"` conversation with
   `AgentService.startConversation(...)`, and mints a short-lived LiveKit participant token.
3. The token embeds `RoomConfiguration` plus `RoomAgentDispatch`, so the `amby-voice` worker is auto-started when
   LiveKit Playground joins the room.
4. `packages/voice/src/worker.ts` validates signed dispatch metadata
   `{ userId, conversationId, source: "playground" }`, creates a user-scoped runtime, and starts a
   `voice.AgentSession`.
5. The session uses Silero VAD, LiveKit turn detection, OpenAI STT, and Cartesia TTS.
6. `AmbyVoiceAgent.llmNode` extracts the latest transcribed user utterance and forwards it to
   `AgentService.streamMessage(...)`.
7. Only text deltas are spoken back to LiveKit. Tool activity stays inside `@amby/agent`, which still records the
   conversation and runs the existing memory/tool/computer stack.

## Key Files

- `packages/voice/src/playground.ts`: Better Auth sign-in, conversation creation, Playground token minting
- `packages/voice/src/worker.ts`: LiveKit worker lifecycle, dispatch validation, STT/TTS/VAD session wiring
- `packages/voice/src/runtime.ts`: shared Effect runtime plus user-scoped `AgentService`
- `packages/agent/src/agent.ts`: conversation creation, persisted message metadata, tool/memory orchestration

## Security

- No public token broker or first-party voice UI in v1
- Tokens are minted only after Better Auth email/password authentication
- Tokens are room-scoped and short-lived
- Dispatch metadata is server-signed in the token and revalidated in the worker
- Each Playground run creates a new persisted `"voice"` conversation bound to the authenticated user
