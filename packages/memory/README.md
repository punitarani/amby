# @amby/memory

User memory management with semantic search via pgvector.

## Responsibilities

- CRUD operations for user memories with pgvector semantic search
- Categorize memories: static (user-set), dynamic (agent-learned), inference (agent-inferred)
- Provide AI SDK tools: `save_memory`, `search_memories`, `forget_memory`
- LRU in-memory caching for hot memory lookups
- Generate memory context prompts for agent turns

## Non-responsibilities

- No embedding generation (embeddings are produced externally)
- No agent orchestration or tool routing (that is `@amby/agent`)

## Key modules

| File | Purpose |
|---|---|
| `src/repository.ts` | MemoryService — CRUD + pgvector semantic search |
| `src/tools.ts` | AI SDK tool definitions (save, search, forget) |
| `src/cache.ts` | LRU in-memory cache |
| `src/prompt-builder.ts` | Memory prompt generation for agent context |
| `src/types.ts` | Memory type definitions |

## Public surface

Exported from `src/index.ts`: `MemoryService`, `createMemoryTools`, `MemoryCache`, `MemoryPromptBuilder`, error types, and memory type definitions.

## Dependency rules

- **Depends on:** `@amby/db`
- **Depended on by:** `@amby/agent`

## Links

- [Architecture](../../docs/ARCHITECTURE.md)
