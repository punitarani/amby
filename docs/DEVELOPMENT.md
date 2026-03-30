# Development Guide

## Prerequisites

| Tool | Required | Install |
|------|----------|---------|
| [Bun](https://bun.sh) 1.3+ | Yes | `curl -fsSL https://bun.sh/install \| bash` |
| [Docker](https://docs.docker.com/get-docker/) | Yes | Desktop or CLI |
| [Doppler](https://docs.doppler.com/docs/install-cli) | No | `.env` fallback works for local dev |

## Quick Start

```bash
bun install                  # 1. Install dependencies
docker compose up -d         # 2. Start PostgreSQL (port 54322)
cp .env.example .env         # 3. Create env file, fill in secrets
bun run db:push              # 4. Apply database schema
bun run dev                  # 5. Start all apps (api :3001, web :3000)
```

If using Doppler, run `doppler setup` first and skip the `.env` copy step.

CI/CD enforces the checked-in migration path: `generate` produces SQL, `migrate` applies pending SQL, and `check` validates the migration history. `db:push` remains a local development shortcut and is not used as the correctness gate in CI.

For Telegram auth work, keep `BETTER_AUTH_URL=http://localhost:3001`. Better Auth is mounted on the API origin and appends `/api/auth` internally.

## Key Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start all apps (wraps `doppler run -- turbo dev`) |
| `bun run build` | Build all packages |
| `bun test` | Run tests (Bun native runner) |
| `bun test --coverage` | Run tests with coverage |
| `bun run typecheck` | Typecheck all packages |
| `bun run lint` | Lint with Biome |
| `bun run format` | Format with Biome |
| `bun run db:generate` | Drizzle codegen |
| `bun run db:migrate` | Run database migrations |
| `bun run db:push` | Push schema to database |
| `bun run db:studio` | Open Drizzle Studio UI |
| `bun run --cwd packages/db db:generate:check` | Ensure schema changes have a committed Drizzle migration |
| `bun run --cwd packages/db db:check` | Validate Drizzle migration-history consistency |
| `bun run --cwd packages/db db:validate` | CI-style migration validation (`generate:check` -> `migrate` -> `check`) |
| `bun run seed` | Seed database |
| `bun run mock` | Start mock channel (port 3100) |

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Default from docker-compose: `postgresql://postgres:postgres@localhost:54322/postgres` |
| `BETTER_AUTH_SECRET` | Yes | Any string for local dev |
| `BETTER_AUTH_URL` | Yes | API origin root, not the web origin. Local default: `http://localhost:3001` |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Get from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_BOT_USERNAME` | For Telegram | Your bot's username |
| `TELEGRAM_LOGIN_WIDGET_ENABLED` | Optional | Enables Login Widget endpoints and mock auth panel flows |
| `TELEGRAM_MINI_APP_ENABLED` | Optional | Enables Mini App endpoints |
| `TELEGRAM_OIDC_CLIENT_ID` | For Telegram OIDC | Client ID from BotFather Web Login |
| `TELEGRAM_OIDC_CLIENT_SECRET` | For Telegram OIDC | Client secret from BotFather Web Login |
| `TELEGRAM_MAX_AUTH_AGE_SECONDS` | Optional | Max age for widget auth replay protection |
| `OPENROUTER_API_KEY` | For LLM | [OpenRouter](https://openrouter.ai) |
| `COMPOSIO_API_KEY` | For integrations | [Composio](https://composio.dev) |
| `DAYTONA_API_KEY` | For sandboxes | [Daytona](https://app.daytona.io) |
| `CLOUDFLARE_API_TOKEN` | For workers | [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens) |

See `.env.example` for the full list.

## Local Dev Workflow

| App | Port | Start |
|-----|------|-------|
| api | 3001 | `bun run dev` (all) or `bun run api:dev` (solo) |
| web | 3000 | `bun run dev` (all) or `bun run web:dev` (solo) |
| mock | 3100 | `bun run mock` |

Docker Compose runs PostgreSQL on port 54322 with pgvector enabled.

### Mock Channel

The mock app emulates a Telegram-like chat interface for local testing without a real bot. It also includes a Telegram auth panel that calls the first-party Better Auth plugin on the API origin.

Start it with `bun run mock` and set:

* `TELEGRAM_API_BASE_URL=http://localhost:3100/api/mock-bot`
* `BETTER_AUTH_URL=http://localhost:3001`
* `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`
* `TELEGRAM_LOGIN_WIDGET_ENABLED=true` if you want widget flows
* `TELEGRAM_MINI_APP_ENABLED=true` if you want Mini App flows

See [CHANNELS.md](./CHANNELS.md), [channels/telegram.md](./channels/telegram.md), and [apps/mock/README.md](../apps/mock/README.md) for details.

### Bun vs Worker API paths

* `bun run api:dev` uses the Bun entrypoint in `apps/api/src/index.ts` and keeps Chat SDK state in memory.
* `bun run api:dev:worker` uses the Cloudflare Worker entrypoint in `apps/api/src/worker.ts` and exercises the Durable Object-backed Chat SDK state path used in production. It runs `wrangler dev --local --no-live-reload`: the Worker executes locally (Miniflare/workerd), `--local` disables remote bindings so all resources use local simulations for that session, and `--no-live-reload` turns off HTML live-reload. Wrangler still rebuilds the bundle when sources change; there is no built-in flag to disable that file watching.

## Testing

**Framework:** Bun's native test runner (`bun:test`).

**File convention:** Tests are co-located with source files as `file.test.ts`.

**Running tests:**

```bash
bun test                                    # All tests
cd packages/agent && bun test               # Single package
bun test packages/agent/src/router.test.ts  # Single file
bun test --coverage                         # With coverage
```

**Mocking:** Hand-crafted doubles, no mock library. Effect services are stubbed with `Effect.succeed(...)`. DB and LLM calls are stubbed at the boundary.

**Test helpers:** Shared factories live in `packages/agent/src/test-helpers/` (e.g., `makeTask()`, `makeResult()`).

**What to test:** Decision logic, architectural boundaries, state machines. Not: schema definitions, migration SQL, trivial barrel exports, third-party internals.

**Adding tests:**

1. Co-locate `module.test.ts` next to `module.ts`
2. Use `describe` blocks matching the function name
3. Test boundary conditions, not just happy paths
4. Use `it.each()` for parametric tests

For Telegram auth changes, prefer this verification order:

1. `bun test packages/auth`
2. `bun test packages/channels`
3. `bun run --filter @amby/api typecheck`
4. `bun run --filter @amby/mock typecheck`
5. `bun run lint`
6. Manual verification with `bun run api:dev` and `bun run mock`

## Docs Maintenance

Update documentation when code changes affect setup, commands, architecture, or conventions. The docs structure:

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Root agent rules and workflow |
| `ARCHITECTURE.md` | System map, modules, invariants |
| `docs/` | Plans, product specs, references, quality standards |

## Further Reading

* [ARCHITECTURE.md](../ARCHITECTURE.md) -- system map and module boundaries
* [channels/telegram.md](./channels/telegram.md) -- channel integration details
* [DATA\_MODEL.md](./DATA_MODEL.md) -- data model and schema reference
