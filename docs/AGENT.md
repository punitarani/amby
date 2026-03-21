# Agent Architecture: Multi-Agent Orchestration

The Amby agent uses a multi-agent orchestration pattern where a single **orchestrator** delegates work to specialized **subagents**. The orchestrator and each subagent are backed by AI SDK v6 `ToolLoopAgent` instances with scoped tools and focused instructions. Subagents are still exposed to the orchestrator as tools, so the overall architecture remains subagents-as-tools.

The user never sees any of this. To them, Amby is just one person getting things done.

---

## How It Works

```
User Message → Orchestrator Agent
                 ├── delegate_research       → Research Subagent (read-only tools)
                 ├── delegate_builder        → Builder Subagent (full sandbox tools)
                 ├── delegate_planner        → Planner Subagent (no tools, pure reasoning)
                 ├── delegate_integration    → Integration Subagent (Composio + connected apps)
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

1. User message arrives → **thread router** resolves which thread to use (heuristic fast-path or model-based routing)
2. Thread-scoped conversation history loaded — recent assistant messages include tool usage annotations for richer context
3. Memory context + datetime + thread synopsis (if resuming a dormant thread) injected into orchestrator's system prompt
4. Orchestrator decides how to handle — answer directly or delegate
5. If delegating: calls e.g. `delegate_builder({ task: "...", context: "..." })`
6. Subagent runs its `ToolLoopAgent` loop (up to `maxSteps`), interacting with sandbox/memory/etc.
7. Subagent returns `{ summary, toolsUsed? }` — the orchestrator sees both the text and what tools were invoked
8. Orchestrator synthesizes the summary into a natural, user-facing response
9. **Trace persistence**: all tool calls and tool results from the generation steps are extracted and saved to `messages.toolCalls` / `messages.toolResults` (jsonb). Subagent results include `toolsUsed` arrays, so the stored trace captures the full execution tree.

Shared context (memories, datetime) is baked into subagent system prompts at spawn time — subagents don't re-query for it.

---

## Subagent Definitions

All definitions live in `packages/agent/src/subagents/definitions.ts`.

| Name | Tool Groups | Max Steps | Role |
|------|-------------|-----------|------|
| `research` | `memory-read`, `computer-read` | 8 | Gather info, read files, search memories, run read-only commands |
| `builder` | `memory-read`, `computer-read`, `computer-write` | 10 | Create/modify files, run code, install packages |
| `planner` | _(none)_ | 3 | Break down complex tasks, pure reasoning |
| `integration` | `integration` | 12 | Handle Composio-backed connected-app tasks and integration management |
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
| `integration` | `list_integrations`, `connect_integration`, `disconnect_integration`, `set_preferred_integration_account`, plus user-scoped Composio session tools | `@amby/connectors` |
| `cua` | `cua_start`, `cua_end`, `cua_screenshot`, `cua_click`, `cua_type`, `cua_key_press`, `cua_scroll`, `cua_cursor_position` | `@amby/computer` |

Both memory and computer tools are split into read/write groups. This gives the research and builder agents read-only memory access (`search_memories`) while restricting `save_memory` to the memory_manager. Similarly, the research agent gets sandbox access without `write_file`. The research agent's `execute_command` is prompt-constrained to read-only operations (ls, cat, grep, find) — the tool itself is the same, but the subagent's system prompt instructs it not to run destructive commands.

### `buildToolGroups(memoryTools, computerTools, cuaTools?, integrationTools?)`

Takes the already-created tool objects from memory, computer, and CUA packages and organizes them into the group structure. CUA tools are optional — the group is omitted when CUA is disabled.

### `resolveTools(keys, groups)`

Merges the requested tool groups into a single flat `ToolSet` for a subagent.

---

## Spawner

`packages/agent/src/subagents/spawner.ts` contains `createSubagentTools()`, which iterates over all subagent definitions and creates one `delegate_<name>` tool per definition.

```ts
createSubagentTools(
  getModel: (id?: string) => LanguageModel,
  toolGroups: ToolGroups,
  sharedPromptContext: string,
  config: AgentConfig,
  requestTraceMetadata: RequestTraceMetadata,
): ToolSet
```

Each delegation tool:
- Has schema `{ task: string, context?: string }`
- Resolves its tools from `toolGroups` using the definition's `toolKeys`
- Creates a fresh `ToolLoopAgent` inside the tool execution with the subagent's instructions, scoped tools, `maxSteps`, and invocation-specific telemetry metadata
- Calls `subagent.generate({ prompt, abortSignal })` so cancellation propagates through tool execution
- Returns `{ summary, toolsUsed? }` on success — `toolsUsed` is a flat array of tool names extracted from `result.steps`, giving the orchestrator (and trace persistence) visibility into what the subagent did. Forwards nested connector `userMessages` when present.
- Returns `{ error: true, summary: "..." }` on failure (errors don't crash the orchestrator)
- Skips any subagent whose required tool groups are unavailable

---

## Orchestrator Wiring

In `packages/agent/src/agent.ts`, the `prepareContext()` function assembles the orchestrator's tool set:

```ts
const requestTraceMetadata = buildRequestTraceMetadata({ conversationId, requestMode, ... })
const delegationTools = createSubagentTools(
  models.getModel,
  toolGroups,
  sharedPromptContext,
  agentConfig,
  requestTraceMetadata,
)

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

### Per-agent model overrides
Subagents default to the default model ID from `ModelService`, but `SubagentDef.modelId` can override it (for example research, planner, and integration use a higher-intelligence model). Tracing is handled through AI SDK `experimental_telemetry` with a shared OpenTelemetry tracer, so orchestrator, tool, and subagent spans nest through the active context.

### Shared no-PII trace metadata
Each top-level request builds trace metadata with internal IDs, enums, and counters (`request_id`, `user_id`, `conversation_id`, request mode, model ID, and related flags). That metadata is attached to orchestrator and subagent AI SDK spans. Prompt context such as memories and formatted time stays in prompts only and is not copied into trace metadata.

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

## Execution Trace Persistence & Context Replay

The agent persists full execution traces and replays them selectively for context-aware follow-ups.

### What gets persisted

Every assistant message stores two jsonb columns alongside the text:

- **`toolCalls`** — `Array<{ toolCallId, toolName, input }>` — every tool the orchestrator invoked during that turn
- **`toolResults`** — `Array<{ toolCallId, toolName, output }>` — every tool result, with large string outputs truncated to 500 chars. Subagent results retain their `{ summary, toolsUsed? }` structure, so the trace captures delegation depth.

Extraction happens via `extractTraceData()`, which flattens all `steps` from the generation result into these two arrays. Both streaming and non-streaming paths capture steps identically. Long string outputs are truncated at the nearest word boundary before 500 characters to avoid cutting mid-word.

### How context replay works

When loading thread history (`loadThreadTail`), the last 4 assistant messages get tool usage annotations appended:

```
Assistant response text here.

[Tools used: delegate_research: Found 3 relevant documents; delegate_builder: Created auth middleware]
```

Older messages load as plain text. This gives the model enough execution context for follow-ups ("can you fix that auth middleware you just created?") without bloating the context window with full tool traces from 20 turns ago.

The `formatArtifactRecap` function separately loads recent tool results with summaries into the system prompt as a "Thread context" section — this provides artifact-level awareness even when the conversation history is truncated.

### Design: persist richly, replay selectively

The DB stores the complete trace (every tool call input/output). The context window sees only lightweight annotations. This means:

- **Debugging**: query `messages.toolCalls` / `messages.toolResults` directly for full execution history
- **Context**: the model gets enough to maintain coherence without wasting tokens on raw tool I/O
- **No new tables**: uses the existing `toolCalls` / `toolResults` jsonb columns on the `messages` table

---

## Thread Routing

The router (`packages/agent/src/router.ts`) resolves which conversation thread each inbound message belongs to. It runs once per request before context assembly.

### Routing strategy

1. **Heuristic fast-path** — zero-latency checks:
   - Time gap < 2 min → continue current thread (confidence: 0.85)
   - Message contains an open thread's label → switch to that thread (confidence: 0.80)
2. **Model fallback** — `generateObject` call with structured output when heuristics are ambiguous. Returns continue (0.65), switch (0.72), or new (0.70).

Confidence values are trace-only metadata for observability — they do not gate downstream logic.

### Archival

Stale threads (>24h inactive) are auto-archived with a generated synopsis. The archival pass:
- Throttles to once per 5 minutes per conversation (`_archiveLastCheck` map, capped at 100 entries with LRU eviction)
- Batch-fetches messages for all threads needing synopsis in a single `inArray` query (avoids N+1)
- Caps synopsis generation at 3 threads per pass to bound LLM cost

### Query optimization

`resolveThread` parallelizes independent DB queries using `Effect.all({ concurrency: 2 })`:
- Open-thread listing and last-message lookup run concurrently
- Thread metadata (status + lastActiveAt) is fetched in a single query that serves both the dormancy check and the status update

### Thread lifecycle

```
new → open → archived
       ↑        |
       +--------+ (re-opened by router)
```

Synopsis generation triggers: thread dormancy (>1h idle), archival (>24h idle), and message count exceeding the tail budget.

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
| `packages/agent/src/subagents/definitions.ts` | Subagent type + definitions (data only) |
| `packages/agent/src/subagents/tool-groups.ts` | Tool grouping + resolution |
| `packages/agent/src/subagents/spawner.ts` | Factory that creates delegation tools |
| `packages/agent/src/subagents/index.ts` | Barrel exports |
| `packages/agent/src/agent.ts` | Orchestrator wiring, trace persistence, context replay |
| `packages/agent/src/router.ts` | Thread routing (heuristic + model fallback), synopsis generation, archival |
| `packages/agent/src/router.test.ts` | Tests for routing heuristics, context replay, artifact recap, trace extraction |
| `packages/agent/src/telemetry.ts` | Shared OpenTelemetry bootstrap + AI SDK telemetry helpers |
| `packages/agent/src/prompts/system.ts` | Orchestrator system prompt with delegation instructions |
| `packages/agent/src/tools/messaging.ts` | `createReplyTools` + `createJobTools` (orchestrator-only) |
