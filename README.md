# Amby

Your personal assistant computer that lives in the cloud and stays on.

Amby runs once — you reach it everywhere. It keeps a living understanding of what you care about, carries context across
devices, runs work while you're offline, and surfaces results before you remember to ask.

## Architecture

```
apps/cli          CLI entry point — REPL interface
packages/
  env             Environment config (Effect.Config + Redacted secrets)
  db              Postgres via Drizzle ORM + Effect service layer
  auth            BetterAuth with Drizzle adapter
  models          OpenRouter provider registry (Claude Haiku 4.5 default)
  memory          Persistent user memory — static facts + dynamic context
  computer        Daytona sandboxes — isolated per-user compute
  channels        Channel abstraction — CLI now, SMS/web/mobile later
  agent           Core agent loop — orchestrates all services via Effect layers
```

## Stack

**Runtime** Bun | **Language** TypeScript | **Architecture** Effect.js (services, layers, typed errors) | **LLM** Vercel
AI SDK v6 via OpenRouter | **Database** Postgres + Drizzle ORM | **Sandbox** Daytona | **Auth** BetterAuth | *
*Lint/Format** Biome

## Setup

```sh
cp .env.example .env    # add your OPENROUTER_API_KEY (required)
bun run setup           # starts Postgres, installs deps, runs migrations + seed
bun run cli             # start the REPL
```

Only `OPENROUTER_API_KEY` is required to get started. Sandbox computer access is optional — add `DAYTONA_API_KEY` to enable it (sign up at [daytona.io](https://app.daytona.io)). If you set `POSTHOG_KEY`, both the API and `apps/web` send analytics to the same PostHog project, and the web app proxies browser traffic through `/_a`.

## Scripts

```sh
bun run format          # format (biome)
bun run lint            # lint (biome)
bun run typecheck       # type-check all packages (tsc)
bun run build           # build all packages (bun build)
```

## Production API Logging

The deployed API runs as a Cloudflare Worker from `apps/api/src/worker.ts`. Production logs are exported to PostHog through Cloudflare Workers Observability OTLP export, with the Worker config expecting a dashboard destination named `posthog-logs`.

Use `${POSTHOG_HOST}/i/v1/logs` for the logs destination with `Authorization: Bearer <POSTHOG_KEY>` using the PostHog project token (`phc_...`).

The Worker also captures uncaught Hono exceptions with `app.onError(...)` via `posthog-node` error tracking. Production source maps for that Worker bundle are injected and uploaded during the deploy workflow with `@posthog/cli`.

The source map upload step uses CI-only PostHog CLI credentials stored in Doppler, not the runtime ingestion vars above: `POSTHOG_CLI_PROJECT_ID` and `POSTHOG_CLI_API_KEY` (a personal API key with `error tracking write` and `organization read` scopes). The CLI host for the current US project is `https://us.posthog.com`.

Reference docs:
- https://posthog.com/docs/libraries/cloudflare-workers
- https://posthog.com/docs/error-tracking/installation/hono
- https://posthog.com/docs/error-tracking/upload-source-maps

This is separate from the existing `posthog-node` usage in the repo for analytics/event capture and application-level agent tracing, and from the Cloudflare OTLP log-export path used for production API Worker logs.
