# Amby

Your personal ambient assistant that lives in the cloud and stays on.

Amby runs once — you reach it everywhere. It keeps a living understanding of what you care about, carries context across devices, runs work while you're offline, and surfaces results before you remember to ask.

## Architecture

```
apps/
  api               Cloudflare Workers API — Telegram adapter, queue runtime
  web               Next.js marketing site
  mock              Mock Telegram chat UI for local development
packages/
  core              Domain models, ports, plugin registry, policies
  env               Environment config (Effect.Config + Redacted secrets)
  db                Postgres via Drizzle ORM + Effect service layer
  auth              BetterAuth with Drizzle adapter
  memory            Persistent user memory — vector search (pgvector) + context
  browser           Web automation via Stagehand + Cloudflare Browser Rendering
  computer          Daytona sandboxes — isolated per-user compute
  plugins           Built-in plugins — integrations (Composio), automations, browser-tools, computer-tools
  skills            Filesystem-based skill discovery and activation
  agent             Conversation engine, execution planner, specialist dispatch
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full dependency graph, layer model, and invariants.

## Stack

**Runtime** Bun | **Language** TypeScript | **Architecture** Effect.js (services, layers, typed errors) | **LLM** Vercel AI SDK v6 via OpenRouter | **Database** Postgres + Drizzle ORM + pgvector | **Sandbox** Daytona | **Browser** Stagehand + Cloudflare Browser Rendering | **Edge** Cloudflare Workers | **Channel** Telegram | **Integrations** Composio | **Auth** BetterAuth | **Lint/Format** Biome

## Setup

```sh
bun install             # install dependencies
docker compose up -d    # start Postgres (port 54322)
cp .env.example .env    # fill in secrets (or use `doppler setup`)
bun run db:push         # apply database schema
bun run dev             # start api (:3001) + web (:3000)
```

`OPENROUTER_API_KEY` and `DATABASE_URL` are required to get started. Optional capabilities: `DAYTONA_API_KEY` for sandbox compute ([daytona.io](https://app.daytona.io)), `TELEGRAM_BOT_TOKEN` for the Telegram channel, `COMPOSIO_API_KEY` for third-party integrations. See `.env.example` for the full list.

Conversations are stored as a platform-level conversation plus internal topic threads. The visible transcript lives on message rows; tool execution is persisted separately as traces for replay and debugging.

## Scripts

```sh
bun run dev             # start all apps (doppler run -- turbo dev)
bun run api:dev         # start API only (hot reload)
bun run mock            # start mock Telegram channel (:3100)
bun test                # run tests (bun native runner)
bun run typecheck       # type-check all packages (tsc)
bun run lint            # lint (biome)
bun run format          # format (biome)
bun run build           # build all packages
bun run db:studio       # open Drizzle Studio UI
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full development guide, environment variables, testing conventions, and local workflow.

## Effect Devtools

`bun install` now auto-patches the workspace TypeScript install through the root `prepare` script so the Effect language service is available in editors and local `tsc` runs. Use `bun run devtools:check` if you want to confirm the patch is still applied.

For VS Code and Cursor, the repo now commits workspace settings that point the editor at `node_modules/typescript/lib` and recommends the `Effect Dev Tools` extension. Start the extension server, then run `EFFECT_DEVTOOLS=1 bun run api` to attach the local Bun entrypoint. If the app needs to connect to a non-local devtools server, also set `EFFECT_DEVTOOLS_URL=ws://host:34437`.

For JetBrains IDEs, enable the TypeScript service and set the project TypeScript package to the workspace install under `node_modules/typescript`. The Effect language service plugin is configured in the shared tsconfig, so once the IDE is using the repo's TypeScript version it should pick up the same diagnostics and refactors.

## Production API

The deployed API runs as a Cloudflare Worker from `apps/api/src/worker.ts`.
