# @amby/db

Database schema, migrations, and query service for the Amby platform.

## Responsibilities

- Define all PostgreSQL table schemas via Drizzle ORM
- Provide `DbService` (Effect service tag) for typed database access
- Own migrations and schema evolution
- Export re-usable Drizzle query operators (`eq`, `and`, `sql`, etc.)
- Supply runtime-specific layers: `DbServiceLive` (Bun/Node), `makeDbServiceFromHyperdrive` (Workers)

## Non-responsibilities

- No business logic or domain rules
- No direct API or HTTP handling
- No environment loading (delegates to `@amby/env`)

## Key modules

| Path | Description |
|------|-------------|
| `src/schema/` | Table definitions: users, conversations, tasks, task-events, jobs, memories, sandboxes, connectors |
| `src/service.ts` | `DbService` tag, `DbServiceLive` layer, `makeDbServiceFromHyperdrive` factory |
| `src/errors.ts` | `DbError` and `NotFoundError` tagged error types |
| `drizzle/` | Generated migrations (10) and relation definitions |

## Public surface

```ts
import { DbService, DbServiceLive, makeDbServiceFromHyperdrive } from "@amby/db"
import * as schema from "@amby/db/schema"
```

## Dependency rules

- **Depends on:** `@amby/env`
- **Depended on by:** `@amby/auth`, `@amby/agent`, and app layers

## Commands

| Script | Purpose |
|--------|---------|
| `db:generate` | Generate a new migration from schema changes |
| `db:migrate` | Apply pending migrations |
| `db:push` | Push schema directly (dev only) |
| `db:studio` | Open Drizzle Studio GUI |

## Links

- [Architecture](../../docs/ARCHITECTURE.md)
- [Data model](../../docs/DATA_MODEL.md)
