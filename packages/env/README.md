# @amby/env

Environment configuration and runtime-specific platform abstractions.

## Responsibilities

- Define the canonical `Env` interface listing all configuration variables
- Provide `EnvService` (Effect service tag) for typed config access
- Supply `EnvServiceLive` for Bun/Node runtimes (reads from `process.env` via Effect Config)
- Supply `makeEnvServiceFromBindings` for Cloudflare Workers runtimes
- Define `WorkflowBinding` and `WorkflowInstanceHandle` interfaces for portable workflow primitives

## Non-responsibilities

- No secrets management or rotation logic
- No runtime business logic
- No direct database or API access

## Key modules

| Path | Description |
|------|-------------|
| `src/shared.ts` | `Env` interface, `EnvService` tag, `EnvError`, workflow binding types |
| `src/local.ts` | `EnvServiceLive` layer for Bun/Node; `makeEffectDevToolsLive` helper |
| `src/workers.ts` | `WorkerBindings` interface, `makeEnvServiceFromBindings` factory |

## Public surface

```ts
import { EnvService, type Env } from "@amby/env"
import { EnvServiceLive } from "@amby/env/local"
import { makeEnvServiceFromBindings } from "@amby/env/workers"
```

## Dependency rules

- **Depends on:** `@effect/experimental`, `@effect/platform` (peer: `effect`)
- **Depended on by:** `@amby/db`, `@amby/auth`, `@amby/agent`, and all app layers

## Links

- [Architecture](../../docs/ARCHITECTURE.md)
