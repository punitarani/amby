These instructions apply to the entire repository unless a deeper `AGENTS.md` overrides them.

## Project

Amby is a cloud-native ambient assistant computer — a persistent, always-on personal assistant that runs in the cloud.
Users reach it from anywhere (CLI today, Telegram, web/mobile later). The core loop: receive input, think with memory,
act with tools, respond — or proactively reach out via scheduled jobs.

## Architecture

- Monorepo managed with Bun workspaces and Turbo.
- Primary language: TypeScript.
- Core architectural style: Effect.js services/layers with typed errors (`Data.TaggedError`, `Context.Tag`, `Layer.effect`).
- All async operations wrapped in `Effect.tryPromise`; services composed via `ManagedRuntime`.
- LLM interactions go through the Vercel AI SDK via OpenRouter as the primary model provider.
- Database: PostgreSQL with Drizzle ORM (direct connection, not Supabase). Cloudflare Hyperdrive for connection pooling in Workers.
- Sandbox compute: Daytona SDK for isolated Linux environments.
- Formatter/linter: Biome.

## Entry Points

- `apps/cli` — Interactive REPL. Readline-based, streams agent responses, runs the job runner in-process.
- `apps/api` — Production API on Cloudflare Workers + Hono. Telegram webhook processing via Queues, Durable Objects
  (per-chat message debouncing), and Workflows (durable multi-step agent execution). Also runs locally via `bun run api`
  with synchronous Telegram processing.

## Packages

| Package            | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `packages/env`     | Type-safe env vars. Local uses Effect Config; Workers variant for CF. |
| `packages/db`      | Drizzle ORM schemas, migrations, database service layer.   |
| `packages/auth`    | BetterAuth with Drizzle adapter and API key plugin.        |
| `packages/models`  | OpenRouter provider registry via `@openrouter/ai-sdk-provider`. |
| `packages/memory`  | Memory storage, retrieval, deduplication, prompt injection. |
| `packages/computer`| Daytona sandbox lifecycle, command execution, CUA tools.   |
| `packages/channels`| Channel interface and adapters (CLI implemented, Telegram types defined). |
| `packages/agent`   | Core agent loop — orchestrates all services. Tools, jobs, system prompts. |

### Dependency flow

```
env ← db ← auth
env ← models
env ← computer
env ← channels
db, models, memory, computer, channels ← agent
agent ← apps/cli, apps/api
```

## Coding Conventions

- Follow the existing TypeScript and Effect.js patterns already in the repo.
- Make focused, minimal changes that match existing patterns.
- Prefer fixing root causes over layered workarounds.
- Keep module boundaries clear across `apps/*` and `packages/*`.
- Reuse existing package exports and service abstractions before adding new ones.
- Keep public interfaces and config types narrow and typed.
- Keep naming explicit; avoid one-letter variable names.
- Do not add inline comments unless the surrounding code genuinely needs clarification.
- Avoid introducing new dependencies unless there is a strong reason.

## Commands

- Install dependencies: `bun install`
- Start CLI: `bun run cli`
- Start API: `bun run api`
- Start API in watch mode: `bun run api:dev`
- Format: `bun run format`
- Lint: `bun run lint`
- Type-check: `bun run typecheck`
- Build: `bun run build`
- Project setup: `bun run setup`
- Generate DB schema: `bun run db:generate`
- Run DB migrations: `bun run db:migrate`
- Push DB schema: `bun run db:push`

## Validation

- For small changes, prefer targeted validation first.
- For broader code changes, run `bun run lint` and `bun run typecheck` before finishing when practical.
- If behavior spans packages, consider `bun run build` after type-checking.

## Environment

- `OPENROUTER_API_KEY` is required for normal local use.
- `DATABASE_URL` and `BETTER_AUTH_SECRET` are required.
- Sandbox computer features are optional and depend on `DAYTONA_API_KEY`.
- Telegram integration requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.
- Some scripts use `doppler run`; preserve that pattern unless the task specifically changes environment loading.
- Do not change environment variable names or secret-loading behavior without checking `packages/env` and the existing
  `.env.example` contract.

## Safety

- Do not commit, rebase, or rewrite git history unless explicitly asked.
- Do not delete files or large sections of code without confirming intent when the change is not clearly required.
- Preserve `.env.example`, `README.md`, and script contracts when making related changes.
