# @amby/api

Core backend service — Telegram bot, agent orchestration, and HTTP API.

## Responsibilities

- Receive and process Telegram webhook events
- Orchestrate agent execution, sandbox provisioning, and volume provisioning workflows
- Manage per-chat conversation state via Durable Objects
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
| `src/bot.ts` | Telegram bot setup and message handlers |
| `src/workflows/agent-execution.ts` | Agent execution workflow |
| `src/workflows/sandbox-provision.ts` | Sandbox provisioning workflow |
| `src/workflows/volume-provision.ts` | Volume provisioning workflow |
| `src/durable-objects/conversation-session.ts` | Per-chat session state |
| `src/queue/` | Queue consumer |
| `src/handlers/` | Event handlers (task-events, reconciliation) |
| `src/telegram/` | Telegram utilities |

## Running

```bash
bun run --filter @amby/api dev        # local Bun server on :3001
bun run --filter @amby/api dev:worker  # local Wrangler dev server
bun run --filter @amby/api typecheck
```

## Endpoints

`GET /` · `GET /health` · `GET /link/:id` · `GET /composio/redirect` · `POST /telegram/webhook`

## Dependencies

Hono, Effect, Sentry, PostHog, grammy (chat/chat-adapter-telegram), plus workspace packages: `@amby/agent`, `@amby/auth`, `@amby/browser`, `@amby/computer`, `@amby/connectors`, `@amby/db`, `@amby/env`, `@amby/memory`.

## Links

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [docs/WORKFLOWS.md](../../docs/WORKFLOWS.md)
- [docs/CHANNELS.md](../../docs/CHANNELS.md)
