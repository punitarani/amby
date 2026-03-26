# Memory System

The memory system gives Amby persistent, per-user recall across conversations. It stores facts and context as text entries with vector embeddings, retrieves them via category filtering and semantic search, and injects relevant memories into the agent's system prompt.

## Memory Categories

| Category | Description | Set by | Example |
|---|---|---|---|
| `static` | Stable user facts and preferences | User or agent (explicit) | "Prefers TypeScript", "Lives in SF" |
| `dynamic` | Temporary or evolving context | Agent (from conversations) | "Currently building a flight tracker" |
| `inference` | Agent-inferred facts | Agent (implicit reasoning) | "Likely a backend engineer" |

Categories are defined in `packages/memory/src/types.ts` as the `MemoryCategory` union type.

## Storage

**Table:** `memories` (defined in `packages/db/src/schema/memories.ts`)

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `userId` | text | Owner (FK to users, cascade delete) |
| `content` | text | The memory text |
| `category` | text | `static`, `dynamic`, or `inference` |
| `isActive` | boolean | Soft-delete flag (default true) |
| `source` | text | Origin (conversation id, manual, etc.) |
| `embedding` | vector(1536) | pgvector embedding for semantic search |
| `metadata` | jsonb | Arbitrary structured data |
| `version` | integer | Version number (starts at 1) |
| `parentId` | uuid | Self-referencing FK for version chains |
| `createdAt` | timestamp | Creation time |
| `updatedAt` | timestamp | Last modification time |

**Index:** `(userId, isActive)` for fast profile lookups.

**Versioning:** When a memory evolves, a new row is created with `parentId` pointing to the previous version. This preserves history without destructive updates.

## Retrieval and Deduplication

`MemoryService.getProfile(userId)` fetches all active memories for a user, ordered by `updatedAt` descending, and splits them into `static` and `dynamic` arrays.

Before injection into prompts, memories are deduplicated with this priority:

```
static > dynamic > search results
```

A memory that appears in a higher-priority category is removed from lower ones. This logic lives in `deduplicateMemories()` in `packages/memory/src/prompt-builder.ts`.

## Prompt Integration

The agent context builder (`packages/agent/src/context/builder.ts`) loads and formats memories for each conversation turn:

1. Calls `MemoryService.getProfile(userId)` to get static and dynamic memories
2. Calls `deduplicateMemories()` to remove duplicates across categories
3. Calls `buildMemoriesText()` to format into markdown sections ("Known Facts", "Recent Context")
4. Injects the result as `# User Memory Context` in the system prompt

The formatted output uses two sections:
- **Known Facts** -- deduplicated static memories as bullet points
- **Recent Context** -- deduplicated dynamic memories as bullet points

## Tools

The agent exposes memory tools to the LLM via `createMemoryTools()` in `packages/memory/src/tools.ts`.

| Tool | Purpose | When used |
|---|---|---|
| `save_memory` | Store a fact or preference | Agent decides something is worth remembering |
| `search_memories` | Recall relevant context | Agent needs to look up user information |

`save_memory` accepts a `content` string and a `category` (`static` or `dynamic`). `search_memories` takes a `query`, filters the user's profile by substring match, and falls back to the 10 most recent memories if no match is found.

Tool groups in the agent runtime:
- `memory-read`: `search_memories` (available in read-only contexts)
- `memory-write`: `save_memory` (requires write permission)

## Cache Layer

`MemoryCache` (`packages/memory/src/cache.ts`) is a `Map`-based cache keyed by `userId:query`. It prevents redundant memory lookups within a single agent tool-calling loop where the same context may be requested multiple times. It has no eviction policy -- it is intended to be short-lived and discarded after the turn completes.

## MemoryService API

Defined in `packages/memory/src/repository.ts` as an Effect service:

| Method | Signature | Description |
|---|---|---|
| `add` | `(userId, content, category?, source?, metadata?) => Effect<string, MemoryError>` | Insert a memory, returns its id |
| `getProfile` | `(userId) => Effect<ProfileMemories, MemoryError>` | Fetch active memories split by category |
| `deactivate` | `(id) => Effect<void, MemoryError>` | Soft-delete a memory (sets `isActive = false`) |

## Key Files

| File | Role |
|---|---|
| `packages/memory/src/types.ts` | `MemoryCategory`, `MemoryItem`, `ProfileMemories`, `DeduplicatedMemories` |
| `packages/memory/src/repository.ts` | `MemoryService` Effect service (CRUD) |
| `packages/memory/src/tools.ts` | `createMemoryTools()` -- agent tool definitions |
| `packages/memory/src/prompt-builder.ts` | `deduplicateMemories()`, `formatProfile()`, `buildMemoriesText()` |
| `packages/memory/src/cache.ts` | `MemoryCache` per-turn cache |
| `packages/memory/src/errors.ts` | `MemoryError` tagged error |
| `packages/db/src/schema/memories.ts` | Drizzle table definition |
| `packages/agent/src/context/builder.ts` | Memory injection into agent system prompt |

## See Also

- [AGENT.md](./AGENT.md) -- agent runtime and tool orchestration
- [PLUGINS_AND_SKILLS.md](./PLUGINS_AND_SKILLS.md) -- plugin system overview
- [DATA_MODEL.md](./DATA_MODEL.md) -- full database schema reference
