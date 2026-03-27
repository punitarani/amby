# @amby/plugins

Built-in plugins for integrations, automations, browser tools, and computer tools.

## Responsibilities

- Provide the integrations plugin (Gmail, Notion, Slack, etc. via Composio)
- Provide the automations plugin (cron, scheduled, event-driven jobs)
- Provide the browser-tools plugin (`browse_web` tool)
- Provide the computer-tools plugin (sandbox execution + query tools)

## Non-responsibilities

- No agent orchestration or conversation logic
- No agent orchestration or memory wiring (memory is a built-in plugin at `@amby/plugins/memory`)
- No skill discovery (skills are in `@amby/skills`)

## Key modules

| Path | Description |
|------|-------------|
| `src/integrations/` | Composio integration plugin — connected app tools, OAuth flows |
| `src/automations/` | Automation plugin — reminders, scheduled work |
| `src/browser-tools/` | Browser tools plugin — `browse_web` via Stagehand |
| `src/computer-tools/` | Computer tools plugin — sandbox task execution and query |
| `src/memory/` | Memory plugin — persistent user memory (profile context + tools) |

## Public surface

```ts
import { createIntegrationsPlugin, createBrowserToolsPlugin, createComputerToolsPlugin, createAutomationsPlugin } from "@amby/plugins"
import { ConnectorsService } from "@amby/plugins/integrations"
import { MemoryServiceLive, createMemoryPlugin, MemoryService } from "@amby/plugins/memory"
```

## Dependency rules

- **Depends on:** `@amby/core`, `@amby/db`, `@amby/env`, `@composio/core`
- **Depended on by:** `apps/api`, `apps/web`

## Links

- [Plugins and Skills](../../docs/PLUGINS_AND_SKILLS.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Browser and Computer](../../docs/BROWSER_AND_COMPUTER.md)
