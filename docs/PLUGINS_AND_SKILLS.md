# Plugins and Skills

## Key Distinction

| Concept | What it is | Where it lives | How it works |
|---------|-----------|----------------|--------------|
| **Plugin** | Executable code that registers tools, context contributors, task runners | `packages/plugins/src/`, `packages/memory/src/`, `packages/skills/src/` | Runs at agent construction time via `PluginRegistry` |
| **Skill** | Instruction bundle loaded from filesystem | `./skills/<name>/SKILL.md` | Discovered at runtime, activated on demand via tools |

Plugins are **runtime behavior**. Skills are **prompt-level behavior**.

---

## Plugin System

### Plugin Contract

```typescript
// packages/core/src/plugins/plugin.ts
interface AmbyPlugin {
  id: string
  register(registry: PluginRegistry): void
}
```

Every plugin implements this interface and is registered during `AgentService` construction in `packages/agent/src/agent.ts`.

### Registry API

The `PluginRegistry` (`packages/core/src/plugins/registry.ts`) exposes these registration methods:

| Method | Purpose |
|--------|---------|
| `addContextContributor()` | Inject text into the system prompt each turn |
| `addToolProvider()` | Provide tools available to the agent |
| `addPlannerHintProvider()` | Guide the execution planner with domain-specific hints |
| `addTaskRunner()` | Register a durable task runner (sandbox, browser, etc.) |
| `addEventHandler()` | Handle agent lifecycle events |

### Built-in Plugins

| Plugin | Package | What it provides |
|--------|---------|-----------------|
| Memory | `packages/memory/src/plugin.ts` | Profile context contributor + `search_memories`, `save_memory`, `forget_memory` tools |
| Integrations | `packages/plugins/src/integrations/plugin.ts` | Connected app tools (Gmail, Notion, Slack, etc.) via Composio |
| Automations | `packages/plugins/src/automations/` | Reminders, scheduled work, cron job management |
| Browser Tools | `packages/plugins/src/browser-tools/plugin.ts` | `browse_web` tool via Stagehand |
| Computer Tools | `packages/plugins/src/computer-tools/plugin.ts` | Sandbox task execution + query tools |
| Skills | `packages/skills/src/plugin.ts` | Skill discovery + `list_skills`, `activate_skill` tools |

### Plugin Composition

All plugins are registered during `AgentService` construction (`packages/agent/src/agent.ts`). The composition root:

1. Creates each plugin instance with its dependencies (services, config)
2. Calls `plugin.register(registry)` for each plugin
3. The registry collects all contributions (tools, context, task runners, event handlers)
4. On each agent turn, the registry provides the assembled tools and context to the model

---

## Skills System

### Overview

Skills are filesystem-based instruction bundles that extend agent behavior without writing plugin code. The flow:

```
discover --> search --> activate --> inject instructions into prompt
```

### Skill File Format

Each skill lives in `./skills/<skill-name>/` with a `SKILL.md` file:

```markdown
---
title: Research Assistant
description: Deep research with source citation
capabilities:
  - browser
  - sandbox
---

## Instructions

1. Break the research question into sub-queries...
2. Use browse_web to gather sources...
3. Cite all claims with URLs...
```

**Front matter fields:**

| Field | Required | Purpose |
|-------|----------|---------|
| `title` | Yes | Display name for `list_skills` |
| `description` | Yes | Short summary for skill search |
| `capabilities` | No | Required runtime capabilities (see below) |

The body contains the instructions injected into the system prompt when the skill is activated.

### Discovery and Activation

**Discovery** (`packages/skills/src/discovery/filesystem-discovery.ts`): Scans the `./skills` directory, parses each `SKILL.md` front matter into a `SkillManifest`.

**Activation** (`packages/skills/src/activation/skill-activation.ts`): Loads the full `SKILL.md` content, resolves any referenced files, and produces an `ActivatedSkill` containing instructions and references for prompt injection.

**Tools provided by the Skills plugin:**

| Tool | Purpose |
|------|---------|
| `list_skills` | Search available skills by keyword or capability |
| `activate_skill` | Load a skill's instructions into the current turn |

### Capability Gating

Skills declare required capabilities in their front matter (e.g., `browser`, `sandbox`). At activation time, the system checks whether the current runtime has those capabilities enabled. If a required capability is unavailable, activation fails with a clear error rather than silently degrading.

---

## Adding a New Plugin

1. Create the plugin file in the appropriate package (e.g., `packages/plugins/src/<name>/plugin.ts`)
2. Implement the `AmbyPlugin` interface
3. In `register()`, call registry methods to add tools, context, task runners, or event handlers
4. Wire the plugin into `AgentService` construction in `packages/agent/src/agent.ts`
5. Add tests for the plugin's tools and context contributions

## Adding a New Skill

1. Create `./skills/<skill-name>/SKILL.md`
2. Add front matter with `title`, `description`, and optional `capabilities`
3. Write clear, step-by-step instructions in the body
4. The skill is automatically discovered -- no code changes needed
5. Test by running `list_skills` and `activate_skill` via the agent

---

## See Also

- [AGENT.md](./AGENT.md) -- agent architecture and execution flow
- [MEMORY.md](./MEMORY.md) -- memory system details
- [BROWSER_AND_COMPUTER.md](./BROWSER_AND_COMPUTER.md) -- browser and sandbox execution
