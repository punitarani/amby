# Voice Agents Runbook

## Required Env

Use Doppler or set these locally before running voice:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`
- `CARTESIA_API_KEY`

If the agent will use computer tools, set the normal `DAYTONA_*` vars too.

## One-Time Setup

Preferred root flow:

```bash
bun install
bun run db:push
```

Optional:

```bash
bun run seed
```

The seeded `demo` user is not enough for voice. Voice testing requires a real Better Auth user.

## Create a Voice Test User

```bash
bun run voice:create-user -- --name "Voice User" --email you@example.com --password "secret123"
```

## Start the Worker

Download the local LiveKit model files first:

```bash
bun run voice:download
```

Then start the worker:

```bash
bun run voice:worker
```

This runs the LiveKit worker in dev mode through the root script wrapper.

## Mint a Playground Token

In another terminal:

```bash
bun run voice:playground -- --email you@example.com --password "secret123"
```

This prints:

- `serverUrl`
- `roomName`
- `participantToken`
- `agentName`
- `conversationId`

## Connect From LiveKit Playground

1. Open LiveKit Playground.
2. Paste `serverUrl` and `participantToken`.
3. Join the room.

The token already embeds `RoomAgentDispatch`, so `amby-voice` should auto-join. Each run creates a fresh `"voice"`
conversation for that authenticated user.

## Troubleshooting

- Auth failure: verify the user was created with `voice:create-user` and the password matches.
- Turn-detector model missing: run `bun run voice:download` once to cache the LiveKit model files locally.
- Worker does not join: verify `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and that `bun run voice:worker`
  is still running.
- No speech input or output: verify `OPENAI_API_KEY` and `CARTESIA_API_KEY`.
