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
| `bun run seed` | Seed database |
| `bun run mock` | Start mock channel (port 3100) |

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Default from docker-compose: `postgresql://postgres:postgres@localhost:54322/postgres` |
| `BETTER_AUTH_SECRET` | Yes | Any string for local dev |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Get from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_BOT_USERNAME` | For Telegram | Your bot's username |
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

The mock app emulates a Telegram-like chat interface for local testing without a real bot. Start it with `bun run mock` and set `TELEGRAM_API_BASE_URL` to point at it. See [CHANNELS.md](./CHANNELS.md) for details.

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

## Docs Maintenance

Update documentation when code changes affect setup, commands, architecture, or conventions. The docs structure:

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Root agent rules and workflow |
| `ARCHITECTURE.md` | System map, modules, invariants |
| `docs/` | Plans, product specs, references, quality standards |

## Further Reading

- [ARCHITECTURE.md](../ARCHITECTURE.md) -- system map and module boundaries
- [CHANNELS.md](./CHANNELS.md) -- channel integration details
- [DATABASE.md](./DATABASE.md) -- schema and migration conventions
