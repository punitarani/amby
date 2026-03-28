# @amby/api

Core backend service — Telegram bot, agent orchestration, and HTTP API.

## Responsibilities

- Receive and process Telegram webhook events
- Orchestrate agent execution, sandbox provisioning, and volume provisioning workflows
- Manage per-chat conversation state via Durable Objects
- Persist Chat SDK transport state in the Worker runtime via a dedicated Durable Object
- Expose HTTP endpoints (health, link redirects, Composio OAuth, webhook)
- Queue-based async task processing

## Non-responsibilities

- Marketing pages or UI rendering (see `apps/web`)
- Agent logic, memory, browser, or database internals (see `packages/`)
- Mock/test Telegram API (see `apps/mock` when available)

## Key modules

| Path | Purpose |
|------|---------|
| `src/index.ts` | Local Bun entrypoint |
| `src/worker.ts` | Cloudflare Workers entrypoint |
| `src/workflows/agent-execution.ts` | Agent execution workflow |
| `src/workflows/sandbox-provision.ts` | Sandbox provisioning workflow |
| `src/workflows/volume-provision.ts` | Volume provisioning workflow |
| `src/durable-objects/conversation-session.ts` | Per-chat session state |
| `src/durable-objects/chat-state.ts` | Chat SDK state DO and Worker-facing state exports |
| `src/chat-state/` | Worker-only Chat SDK state adapter |
| `src/queue/` | Queue consumer |
| `src/handlers/` | Event handlers (task-events, reconciliation) |

## Running

```bash
bun run --filter @amby/api dev        # local Bun server on :3001
bun run --filter @amby/api dev:worker  # local Wrangler dev server
bun run --filter @amby/api typecheck
bun run --filter @amby/api deploy      # production Worker deploy
```

Deploys derive the Worker version message from `WORKER_VERSION_MESSAGE` when it is set; otherwise they use the latest git commit subject. The message is normalized to Cloudflare's 100-character limit before `wrangler deploy` runs.

## Endpoints

`GET /` · `GET /health` · `GET /link/:id` · `GET /composio/redirect` · `POST /telegram/webhook`

## Dependencies

Hono, Effect, Sentry, PostHog, @chat-adapter/telegram, plus workspace packages: `@amby/agent`, `@amby/auth`, `@amby/browser`, `@amby/computer`, `@amby/core`, `@amby/db`, `@amby/env`, `@amby/plugins`, `@amby/skills`.

## Links

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [docs/RUNTIME.md](../../docs/RUNTIME.md)
- [docs/channels/telegram.md](../../docs/channels/telegram.md)
