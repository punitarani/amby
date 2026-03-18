# Agent Architecture: Multi-Agent Orchestration

The Amby agent uses a multi-agent orchestration pattern where a single **orchestrator** delegates work to specialized **subagents**. Each subagent is implemented as a tool that internally runs its own `generateText()` loop with restricted tools and a focused system prompt. This follows the AI SDK v6 idiom of subagents-as-tools — no custom classes or abstractions needed.

The user never sees any of this. To them, Amby is just one person getting things done.

---

## How It Works

```
User Message → Orchestrator Agent
                 ├── delegate_research       → Research Subagent (read-only tools)
                 ├── delegate_builder        → Builder Subagent (full sandbox tools)
                 ├── delegate_planner        → Planner Subagent (no tools, pure reasoning)
                 ├── delegate_computer       → Computer Subagent (CUA/GUI tools)
                 ├── delegate_memory_manager → Memory Subagent (memory tools)
                 ├── search_memories         → Direct read-only memory access
                 ├── send_message            → Immediate reply to user
                 ├── schedule_job            → Job scheduling
                 └── set_timezone            → Timezone setting
```

The orchestrator keeps lightweight coordination tools (reply, jobs, read-only memory search). All heavy lifting goes through delegation.

---

## Message Flow

1. User message arrives → orchestrator loads conversation history + memory profile
2. Memory context + datetime injected into orchestrator's system prompt
3. Orchestrator decides how to handle — answer directly or delegate
4. If delegating: calls e.g. `delegate_builder({ task: "...", context: "..." })`
5. Subagent receives: its own system prompt + shared context (memories, datetime) + task
6. Subagent runs its tool loop (up to `maxSteps`), interacting with sandbox/memory/etc.
7. Subagent's `result.text` returned as tool result to orchestrator
8. Orchestrator synthesizes the summary into a natural, user-facing response

Shared context (memories, datetime) is baked into subagent system prompts at spawn time — subagents don't re-query for it.

---

## Subagent Definitions

All definitions live in `packages/agent/src/subagents/definitions.ts`.

| Name | Tool Groups | Max Steps | Role |
|------|-------------|-----------|------|
| `research` | `memory-read`, `computer-read` | 8 | Gather info, read files, search memories, run read-only commands |
| `builder` | `memory-read`, `computer-read`, `computer-write` | 10 | Create/modify files, run code, install packages |
| `planner` | _(none)_ | 3 | Break down complex tasks, pure reasoning |
| `computer` | `cua` | 15 | GUI interaction via desktop (only available when CUA is enabled) |
| `memory_manager` | `memory-read`, `memory-write` | 5 | Save/organize/search user memories |

Each definition is a plain data object (`SubagentDef`) with a focused system prompt instructing the subagent to execute its task and return a concise summary. Subagents never address the user directly — the orchestrator handles all user-facing communication.

---

## Tool Groups

Tools are organized into named groups in `packages/agent/src/subagents/tool-groups.ts`. Subagent definitions reference groups by key, and the spawner resolves them into flat tool sets.

| Group | Tools | Source |
|-------|-------|--------|
| `memory-read` | `search_memories` | `@amby/memory` |
| `memory-write` | `save_memory` | `@amby/memory` |
| `computer-read` | `execute_command`, `read_file` | `@amby/computer` |
| `computer-write` | `write_file` | `@amby/computer` |
| `cua` | `cua_start`, `cua_end`, `cua_screenshot`, `cua_click`, `cua_type`, `cua_key_press`, `cua_scroll`, `cua_cursor_position` | `@amby/computer` |

Both memory and computer tools are split into read/write groups. This gives the research and builder agents read-only memory access (`search_memories`) while restricting `save_memory` to the memory_manager. Similarly, the research agent gets sandbox access without `write_file`. The research agent's `execute_command` is prompt-constrained to read-only operations (ls, cat, grep, find) — the tool itself is the same, but the subagent's system prompt instructs it not to run destructive commands.

### `buildToolGroups(memoryTools, computerTools, cuaTools?)`

Takes the already-created tool objects from memory, computer, and CUA packages and organizes them into the group structure. CUA tools are optional — the group is omitted when CUA is disabled.

### `resolveTools(keys, groups)`

Merges the requested tool groups into a single flat `ToolSet` for a subagent.

---

## Spawner

`packages/agent/src/subagents/spawner.ts` contains `createSubagentTools()`, which iterates over all subagent definitions and creates one `delegate_<name>` tool per definition.

```ts
createSubagentTools(model: LanguageModel, toolGroups: ToolGroups, sharedContext: string): ToolSet
```

Each delegation tool:
- Has schema `{ task: string, context?: string }`
- Resolves its tools from `toolGroups` using the definition's `toolKeys`
- Calls `generateText()` with the subagent's system prompt + shared context + task as user message
- Returns `{ summary: result.text }` on success
- Returns `{ error: true, summary: "..." }` on failure (errors don't crash the orchestrator)
- Skips the `computer` subagent entirely when CUA tools aren't available

---

## Orchestrator Wiring

In `packages/agent/src/agent.ts`, the `prepareContext()` function assembles the orchestrator's tool set:

```ts
const delegationTools = createSubagentTools(baseModel, toolGroups, sharedContext)

const { search_memories } = memoryTools
const tools = {
    ...delegationTools,        // delegate_research, delegate_builder, etc.
    search_memories,           // read-only, so orchestrator can check context before delegating
    ...createJobTools(...),    // schedule_job, set_timezone
    ...(onReply ? createReplyTools(onReply) : {}),  // send_message
}
```

The orchestrator keeps `search_memories` directly so it can check user context before deciding how to delegate. Only memory writes go through the `delegate_memory_manager` subagent.

---

## System Prompt

The orchestrator's system prompt (`packages/agent/src/prompts/system.ts`) includes a "How You Work" section (marked as internal — never exposed to the user) that tells the orchestrator:

- **Available Agents** — what each delegation tool does
- **When to Delegate** — decision guide (answer directly vs. research vs. build vs. plan-then-build)
- **Orchestration Rules** — use `search_memories` first, send progress updates before delegating, chain agents sequentially, synthesize results naturally

---

## Design Decisions

### Orchestrator-only delegation
Subagents cannot spawn other subagents. The orchestrator chains them sequentially when needed (e.g., `delegate_planner` then `delegate_builder`). Simpler, easier to debug.

### Same model for all agents
All subagents use the base model (`models.getModel()`). The `modelId` field exists in `SubagentDef` for future per-agent overrides but isn't wired yet. Subagents receive the untraced model — PostHog tracing only covers orchestrator-level LLM calls, which avoids double-counting tokens but means subagent calls aren't individually trackable in analytics.

### Read-only memory on orchestrator
The orchestrator gets `search_memories` directly (destructured from the full memory tools) rather than the full `save_memory` + `search_memories` set. This lets the orchestrator check user context before deciding how to delegate without being tempted to write memories itself.

### Prompt-constrained read-only sandbox
The research agent receives the same `execute_command` tool as the builder but is instructed via system prompt to only run read operations. This keeps the code simple (no separate read-only command tool) at the cost of relying on prompt compliance.

---

## Error Handling

- Subagent failures are caught in a try/catch inside the delegation tool's `execute` function
- Errors return `{ error: true, summary: "Failed to complete task: ..." }` as a normal tool result
- The orchestrator can retry, delegate to a different agent, or report the issue to the user
- Infrastructure-level failures (DB, network) still propagate through Effect's error channel

---

## Adding a New Subagent

1. Add a `SubagentDef` object to the `SUBAGENT_DEFS` array in `definitions.ts`
2. If it needs new tools, add a new tool group to `buildToolGroups()` in `tool-groups.ts`
3. Add the new `delegate_<name>` tool to the "Available Agents" section in `system.ts`
4. Done — the spawner auto-generates the delegation tool

---

## File Map

| File | Role |
|------|------|
| `packages/agent/src/subagents/definitions.ts` | Subagent type + 5 definitions (data only) |
| `packages/agent/src/subagents/tool-groups.ts` | Tool grouping + resolution |
| `packages/agent/src/subagents/spawner.ts` | Factory that creates delegation tools |
| `packages/agent/src/subagents/index.ts` | Barrel exports |
| `packages/agent/src/agent.ts` | Orchestrator wiring in `prepareContext()` |
| `packages/agent/src/prompts/system.ts` | Orchestrator system prompt with delegation instructions |
| `packages/agent/src/tools/messaging.ts` | `createReplyTools` + `createJobTools` (orchestrator-only) |
