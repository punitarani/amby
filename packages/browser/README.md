# @amby/browser

Web automation and data extraction via Stagehand (Playwright-based).

## Responsibilities

- Define the `BrowserService` interface and typed task model (input, result, progress)
- Provide local implementation using Bun + Playwright (`./local`)
- Provide Cloudflare Browser Rendering implementation (`./workers`)
- Support three task modes: extract, act, agent
- Classify side-effect levels (read, soft-write, hard-write) and detect escalation signals

## Non-responsibilities

- No tool registration (tool definitions live in `@amby/agent` browser-tools)
- No task persistence or execution tracking
- No agent orchestration

## Key modules

| File | Purpose |
|---|---|
| `src/shared.ts` | BrowserService tag, types, mode/side-effect inference, URL sanitization |
| `src/local.ts` | Local Playwright-based Stagehand implementation |
| `src/workers.ts` | Cloudflare Browser Rendering implementation |

## Public surface

- Default export (`"."`): types, `BrowserService` tag, helper functions from `shared.ts`
- `"./local"`: local browser provider
- `"./workers"`: Cloudflare workers browser provider

## Dependency rules

- **Depends on:** `@amby/env`
- **Depended on by:** `@amby/agent`

## Links

- [Architecture](../../docs/ARCHITECTURE.md)
