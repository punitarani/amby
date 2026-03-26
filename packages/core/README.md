# @amby/core

Domain kernel — models, ports, plugin registry, and policies.

## Responsibilities

- Define domain models (platform, compute, integration, automation)
- Define port interfaces (BrowserProvider, ComputerProvider, repositories)
- Own the `PluginRegistry` and `AmbyPlugin` contract
- Define policies (tool groups, budgets)
- Define shared error types (`CoreError`)

## Non-responsibilities

- No implementations — only interfaces and types
- No database access or external API calls
- No runtime or orchestration logic

## Key modules

| Path | Description |
|------|-------------|
| `src/domain/` | Domain models: platform, compute, integration, automation |
| `src/ports/` | Port interfaces: BrowserProvider, ComputerProvider, repositories |
| `src/plugins/` | `AmbyPlugin` interface, `PluginRegistry` (context, tools, task runners, events) |
| `src/policies/` | Tool group definitions, budget policies |
| `src/errors/` | `CoreError` tagged error type |

## Public surface

```ts
import { PluginRegistry, type AmbyPlugin } from "@amby/core"
import { type BrowserProvider, type ComputerProvider } from "@amby/core"
```

## Dependency rules

- **Depends on:** nothing (peer: `effect`)
- **Depended on by:** every other `@amby/*` package

This is the foundation package — it must never gain workspace dependencies.

## Links

- [Architecture](../../docs/ARCHITECTURE.md)
- [Plugins and Skills](../../docs/PLUGINS_AND_SKILLS.md)
