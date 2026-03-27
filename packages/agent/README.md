# @amby/agent

Agent orchestration, model inference, tool routing, and execution coordination.

## Responsibilities

- Resolve conversation threads (4-stage routing: default, stale, native, derived)
- Assemble context from history, memory, summaries, and plugins
- Run conversation turns via Vercel AI SDK ToolLoopAgent (max 8 steps)
- Plan and coordinate execution (direct, sequential, parallel, background modes)
- Provide direct tools: save/search memories, send messages, execute plans, query execution

## Non-responsibilities

- No direct Telegram or channel handling (that is `apps/api` via `@chat-adapter/telegram`)
- No HTTP endpoints or webhook processing (that is the Cloudflare worker in `apps/api`)
- No memory storage or embedding (that is `@amby/plugins/memory` and `@amby/db`)

## Key modules

| File | Purpose |
|---|---|
| `src/agent.ts` | AgentService composition — wires tools, plugins, and services |
| `src/router.ts` | Thread resolution (4-stage routing) |
| `src/context/builder.ts` | Context assembly (history, memory, summaries) |
| `src/execution/coordinator.ts` | Plan execution orchestrator |
| `src/execution/planner.ts` | Execution plan generation |
| `src/execution/registry.ts` | Tool group registry |
| `src/tools/messaging.ts` | Reply and job tools |
| `src/models.ts` | LLM provider setup |
| `src/telemetry.ts` | Trace and span management |

## Public surface

Exported from `src/index.ts`: `AgentService`, `AgentError`, job utilities, model config, router, synopsis, messaging tools, and type definitions for agent, browser, execution, persistence, and settings.

## Dependency rules

- **Depends on:** `@amby/core`, `@amby/browser`, `@amby/computer`, `@amby/db`, `@amby/env`
- **Depended on by:** Cloudflare worker runtime (`apps/`)

## Links

- [Architecture](../../docs/ARCHITECTURE.md)
