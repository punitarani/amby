# MEMORY.md

## Purpose

This document describes how to build a **memory package** inside a Turborepo monorepo for use with the Vercel AI SDK.

The goal is simple:

- store memories
- retrieve memories
- manage memories
- inject relevant memories into model calls
- optionally save new memories after assistant responses

This package is **not** an API service.
This package is **not** a full product backend.
This package is a **library layer** that your apps can call directly.

The design assumes you may later back it with Postgres + pgvector + Drizzle ORM, but the package should be written so
the storage layer can be swapped without changing the public API.

---

## Scope

We only care about functions that are useful for an LLM workflow.

That means the package should expose things like:

- add a memory
- add a conversation
- search memories
- build memory context text for prompts
- deduplicate memories across categories
- inject memories into system prompts
- optionally save memory after a response
- cache memory lookups during a single turn

We do **not** need:

- HTTP routes
- REST handlers
- auth middleware
- OAuth flows
- dashboards
- ingestion UIs
- background workers in this package

Those can exist elsewhere. This package should stay boring and sharp.

---

## Monorepo Package Layout

A clean setup in Turborepo looks like this:

```plain text
packages/
  db/
    src/
      schema/
        documents.ts
        chunks.ts
        spaces.ts
        memory-entries.ts
        memory-document-sources.ts
        documents-to-spaces.ts
      client.ts
      index.ts

  memory/
    src/
      types.ts
      repository.ts
      cache.ts
      dedupe.ts
      prompt-builder.ts
      search.ts
      store.ts
      conversations.ts
      middleware.ts
      vercel.ts
      index.ts

  validation/
    src/
      memory.ts
      documents.ts
      prompts.ts
      index.ts
````

### Package responsibilities

#### `packages/db`

Owns Drizzle schema and database client setup.

#### `packages/validation`

Owns Zod input/output schemas and shared types.

#### `packages/memory`

Owns the actual memory logic:

* storage orchestration
* retrieval orchestration
* formatting
* dedupe
* Vercel AI SDK integration
* per-turn caching

This separation matters. If you cram everything into one package, future-you will build a cathedral of suffering.

---

## Core Design Principles

### 1. Repository-first design

Your memory package should depend on an abstract repository interface, not directly on Drizzle queries everywhere.

That lets you:

* test logic without a database
* replace the backend later
* keep Vercel SDK middleware clean

### 2. Separate raw content from extracted memory facts

Do not store only “memory strings.”
Store both:

* raw source material like notes, messages, or conversation transcripts
* distilled memory entries extracted from those sources

This gives you provenance, better debugging, and sane future evolution.

### 3. Separate profile memory from search memory

For prompt building, split memories into categories:

* **static**: stable user facts
* **dynamic**: current or recently changing context
* **search results**: query-specific relevant memories

Then deduplicate in this priority order:

```plain text
static > dynamic > searchResults
```

That priority is the least stupid version of this problem.

### 4. Keep injection pure

Prompt injection functions should be pure and non-mutating.
Given model params and memory text, return new params.

### 5. Cache within a turn

During a tool-calling loop, the same user turn may hit memory lookup multiple times.
Do not pay for the same lookup over and over like a clown.
Use a per-turn cache.

---

## Recommended Data Model

Even though this package is not an API, it still needs a sane data model.

You should model six core concepts.

---

## 1. Documents

A document is the root unit of ingested content.

Examples:

* a note
* a pasted block of text
* a chat transcript
* a webpage snapshot
* a PDF
* a conversation record

Suggested fields:

```ts
type DocumentType =
  | "text"
  | "pdf"
  | "webpage"
  | "google_doc"
  | "google_sheet"
  | "google_slide"
  | "notion_doc"
  | "image"
  | "video"

type DocumentStatus =
  | "unknown"
  | "queued"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "done"
  | "failed"

interface DocumentRecord {
  id: string
  customId?: string | null
  contentHash?: string | null

  userId: string
  connectionId?: string | null

  title?: string | null
  content?: string | null
  summary?: string | null
  url?: string | null
  source?: string | null
  type: DocumentType
  status: DocumentStatus

  metadata?: Record<string, unknown> | null
  processingMetadata?: Record<string, unknown> | null
  raw?: unknown | null
  ogImage?: string | null

  tokenCount?: number | null
  wordCount?: number | null
  chunkCount: number
  averageChunkSize?: number | null

  summaryEmbedding?: number[] | null
  summaryEmbeddingModel?: string | null
  summaryEmbeddingNew?: number[] | null
  summaryEmbeddingModelNew?: string | null

  createdAt: Date
  updatedAt: Date
}
```

### Why documents exist

Because memories should not float around detached from source material.
You want traceability.

---

## 2. Chunks

Documents can be split into chunks for semantic retrieval.

```ts
type ChunkType = "text" | "image"

interface ChunkRecord {
  id: string
  documentId: string
  content: string
  embeddedContent?: string | null
  type: ChunkType
  position: number
  metadata?: Record<string, unknown> | null

  embedding?: number[] | null
  embeddingModel?: string | null
  embeddingNew?: number[] | null
  embeddingNewModel?: string | null
  matryoshkaEmbedding?: number[] | null
  matryoshkaEmbeddingModel?: string | null

  createdAt: Date
}
```

### Why chunks exist

Because retrieval on whole documents is often too blunt.
Chunks give you better recall and less garbage.

---

## 3. Spaces

A space is the container or namespace for memories.

Examples:

* a user
* a project
* a workspace
* a thread-scoped memory area

```ts
type Visibility = "public" | "private" | "unlisted"

interface SpaceRecord {
  id: string
  name?: string | null
  description?: string | null
  ownerId: string

  containerTag?: string | null
  visibility: Visibility
  isExperimental: boolean

  contentTextIndex?: Record<string, unknown>
  indexSize?: number | null

  metadata?: Record<string, unknown> | null

  createdAt: Date
  updatedAt: Date
}
```

### Why spaces exist

You need a stable grouping primitive.
A single user might have:

* personal memory
* work memory
* project-specific memory

A `containerTag` or equivalent is a flexible way to scope all of that.

---

## 4. Memory Entries

This is the heart of the system.

A memory entry is a distilled fact, preference, or useful piece of context.

```ts
type MemoryRelation = "updates" | "extends" | "derives"

interface MemoryEntryRecord {
  id: string
  memory: string
  spaceId: string
  userId?: string | null

  version: number
  isLatest: boolean
  parentMemoryId?: string | null
  rootMemoryId?: string | null

  memoryRelations: Record<string, MemoryRelation>

  sourceCount: number

  isInference: boolean
  isForgotten: boolean
  isStatic: boolean
  forgetAfter?: Date | null
  forgetReason?: string | null

  memoryEmbedding?: number[] | null
  memoryEmbeddingModel?: string | null
  memoryEmbeddingNew?: number[] | null
  memoryEmbeddingNewModel?: string | null

  metadata?: Record<string, unknown> | null

  createdAt: Date
  updatedAt: Date
}
```

### Why this structure matters

#### `isStatic`

Lets you separate stable profile facts from short-lived context.

Examples:

Static:

* user prefers TypeScript
* user lives in San Francisco
* user works as a software engineer

Dynamic:

* user is currently building a flight price tracker
* user is planning a Miami trip
* user is exploring orchestration patterns this week

#### Version chain fields

These allow memory evolution without deleting history.

Example:

* v1: User works at Company A
* v2: User recently joined Company B

You should mark v2 as latest and link it to v1.

#### `isInference`

A memory inferred by the system should not be treated exactly like explicit user-provided data.
That distinction matters.

#### `forgetAfter`

Some memories should expire.
Not everything deserves eternal digital embalming.

---

## 5. Memory Document Sources

This table links memory entries back to source documents.

```ts
interface MemoryDocumentSourceRecord {
  memoryEntryId: string
  documentId: string
  relevanceScore: number
  metadata?: Record<string, unknown> | null
  addedAt: Date
}
```

### Why this exists

Because provenance matters.
You should be able to answer:

* where did this memory come from?
* what source supported it?
* why was it extracted?

---

## 6. Documents to Spaces

A document may belong to more than one space.

```ts
interface DocumentToSpaceRecord {
  documentId: string
  spaceId: string
}
```

This is better than hardcoding one document to one user bucket forever.

---

## Repository Interface

Your public package should not expose Drizzle directly.
Instead, define an interface like this:

```ts
export interface MemoryRepository {
  addDocument(input: AddDocumentInput): Promise<DocumentRecord>

  addConversation(input: AddConversationInput): Promise<DocumentRecord>

  addMemoryEntry(input: AddMemoryEntryInput): Promise<MemoryEntryRecord>

  updateMemoryEntry(input: UpdateMemoryEntryInput): Promise<MemoryEntryRecord>

  findSpaceByTag(containerTag: string): Promise<SpaceRecord | null>

  ensureSpace(input: EnsureSpaceInput): Promise<SpaceRecord>

  searchMemoryEntries(input: SearchMemoriesInput): Promise<MemorySearchResult[]>

  listProfileMemories(input: ListProfileMemoriesInput): Promise<{
    static: MemoryItem[]
    dynamic: MemoryItem[]
  }>

  linkMemoryToDocument(input: LinkMemoryToDocumentInput): Promise<void>

  getMemoryById(id: string): Promise<MemoryEntryRecord | null>

  getDocumentById(id: string): Promise<DocumentRecord | null>
}
```

This is the seam that keeps the architecture from turning into soup.

---

## Public Types

Your memory package should expose a small set of stable types.

```ts
export type MemoryMode = "profile" | "query" | "full"

export interface MemoryItem {
  memory: string
  metadata?: Record<string, unknown>
}

export interface ProfileWithMemories {
  static?: Array<MemoryItem | string>
  dynamic?: Array<MemoryItem | string>
  searchResults?: Array<MemoryItem | string>
}

export interface DeduplicatedMemories {
  static: string[]
  dynamic: string[]
  searchResults: string[]
}

export interface MemoryPromptData {
  userMemories: string
  generalSearchMemories: string
}

export type PromptTemplate = (data: MemoryPromptData) => string

export interface BuildMemoriesTextOptions {
  containerTag: string
  queryText: string
  mode: MemoryMode
  repository: MemoryRepository
  promptTemplate?: PromptTemplate
}
```

---

## Functions to Expose

This is the meat.

Your package should export only the functions that matter to LLM workflows.

---

## 1. `addMemory`

Stores a single memory-like content item.

Use when:

* a tool explicitly decides to remember something
* your app wants to persist a user fact
* you want to store a note or text item that may later produce memory entries

```ts
export interface AddMemoryParams {
  content: string
  containerTags: string[]
  customId?: string
  metadata?: Record<string, string | number | boolean>
  entityContext?: string
}

export async function addMemory(
  repository: MemoryRepository,
  params: AddMemoryParams,
): Promise<DocumentRecord>
```

### Behavior

* resolve or create the target spaces from `containerTags`
* create a document
* associate document with spaces
* optionally trigger memory extraction if your app supports it
* return the stored document

### Opinion

Do not make `addMemory()` secretly do fifty things.
It should orchestrate storage cleanly and predictably.

---

## 2. `addConversation`

Stores a structured multi-turn conversation.

Use when:

* you want durable conversation memory
* you want to upsert the same thread repeatedly
* you want memory extraction from chat history

```ts
export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
}

export interface AddConversationParams {
  conversationId: string
  messages: ConversationMessage[]
  containerTags: string[]
  metadata?: Record<string, unknown>
}

export async function addConversation(
  repository: MemoryRepository,
  params: AddConversationParams,
): Promise<DocumentRecord>
```

### Behavior

* serialize the conversation into a canonical document format
* use a stable custom ID like `conversation:${conversationId}`
* upsert rather than duplicate when possible
* associate with spaces
* optionally extract memories from the transcript

### Opinion

Conversation storage should be first-class.
Trying to reconstruct chat memory from scattered one-off note writes is janky.

---

## 3. `searchMemories`

Searches for relevant memories for the current query.

```ts
export interface SearchMemoriesParams {
  informationToGet: string
  containerTags: string[]
  limit?: number
  includeFullDocs?: boolean
}

export interface MemorySearchResult {
  memory: string
  metadata?: Record<string, unknown>
  similarity?: number
  documentId?: string
  content?: string | null
}

export async function searchMemories(
  repository: MemoryRepository,
  params: SearchMemoriesParams,
): Promise<MemorySearchResult[]>
```

### Behavior

* search memories scoped by container tags
* return the most relevant items
* optionally include linked source content

### Opinion

Keep the interface simple.
The LLM does not need a PhD thesis worth of knobs on every tool call.

---

## 4. `getProfileMemories`

Returns memories split into static and dynamic categories.

```ts
export interface GetProfileMemoriesParams {
  containerTag: string
}

export async function getProfileMemories(
  repository: MemoryRepository,
  params: GetProfileMemoriesParams,
): Promise<{
  static: MemoryItem[]
  dynamic: MemoryItem[]
}>
```

### Behavior

* fetch latest non-forgotten memories for the container
* separate by `isStatic`

This is the basis for profile mode.

---

## 5. `deduplicateMemories`

Deduplicates memory content across categories.

```ts
export function deduplicateMemories(
  data: ProfileWithMemories,
): DeduplicatedMemories
```

### Rules

Priority order:

```plain text
static > dynamic > searchResults
```

### Reference implementation

```ts
export function deduplicateMemories(
  data: ProfileWithMemories,
): DeduplicatedMemories {
  const staticItems = data.static ?? []
  const dynamicItems = data.dynamic ?? []
  const searchItems = data.searchResults ?? []

  const getMemoryString = (item: MemoryItem | string): string | null => {
    if (!item) return null

    if (typeof item === "string") {
      const trimmed = item.trim()
      return trimmed.length > 0 ? trimmed : null
    }

    if (typeof item.memory !== "string") return null
    const trimmed = item.memory.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const seen = new Set<string>()
  const staticMemories: string[] = []
  const dynamicMemories: string[] = []
  const searchMemories: string[] = []

  for (const item of staticItems) {
    const memory = getMemoryString(item)
    if (memory && !seen.has(memory)) {
      staticMemories.push(memory)
      seen.add(memory)
    }
  }

  for (const item of dynamicItems) {
    const memory = getMemoryString(item)
    if (memory && !seen.has(memory)) {
      dynamicMemories.push(memory)
      seen.add(memory)
    }
  }

  for (const item of searchItems) {
    const memory = getMemoryString(item)
    if (memory && !seen.has(memory)) {
      searchMemories.push(memory)
      seen.add(memory)
    }
  }

  return {
    static: staticMemories,
    dynamic: dynamicMemories,
    searchResults: searchMemories,
  }
}
```

This function is tiny, but it saves you from stuffing duplicated context into prompts like a garbage compactor.

---

## 6. `convertProfileToMarkdown`

Formats static and dynamic memories into readable markdown.

```ts
export interface ProfileMarkdownData {
  profile: {
    static?: string[]
    dynamic?: string[]
  }
}

export function convertProfileToMarkdown(data: ProfileMarkdownData): string
```

### Reference implementation

```ts
export function convertProfileToMarkdown(data: ProfileMarkdownData): string {
  const sections: string[] = []

  if (data.profile.static?.length) {
    sections.push("## Static Profile")
    sections.push(data.profile.static.map((item) => `- ${item}`).join("\n"))
  }

  if (data.profile.dynamic?.length) {
    sections.push("## Dynamic Profile")
    sections.push(data.profile.dynamic.map((item) => `- ${item}`).join("\n"))
  }

  return sections.join("\n\n")
}
```

---

## 7. `formatMemoriesForPrompt`

Applies a template to memory data.

```ts
export const defaultPromptTemplate: PromptTemplate = (data) =>
  `User Memories:\n${data.userMemories}\n${data.generalSearchMemories}`.trim()

export function formatMemoriesForPrompt(
  data: MemoryPromptData,
  template: PromptTemplate = defaultPromptTemplate,
): string {
  return template(data)
}
```

### Opinion

Keep templating pluggable.
Hardcoding one prompt style forever is how elegant packages become annoying packages.

---

## 8. `buildMemoriesText`

This is the main orchestrator for retrieval + formatting.

```ts
export async function buildMemoriesText(
  options: BuildMemoriesTextOptions,
): Promise<string>
```

### Behavior

Given:

* `containerTag`
* `queryText`
* `mode`
* `repository`

It should:

1. load profile memories when mode is `profile` or `full`
2. load search memories when mode is `query` or `full`
3. deduplicate them
4. format them into markdown / prompt text
5. return a single string ready for injection

### Suggested implementation shape

```ts
export async function buildMemoriesText(
  options: BuildMemoriesTextOptions,
): Promise<string> {
  const {
    containerTag,
    queryText,
    mode,
    repository,
    promptTemplate = defaultPromptTemplate,
  } = options

  const profile =
    mode !== "query"
      ? await getProfileMemories(repository, { containerTag })
      : { static: [], dynamic: [] }

  const searchResults =
    mode !== "profile" && queryText.trim()
      ? await searchMemories(repository, {
        informationToGet: queryText,
        containerTags: [containerTag],
        limit: 10,
        includeFullDocs: false,
      })
      : []

  const deduplicated = deduplicateMemories({
    static: profile.static,
    dynamic: profile.dynamic,
    searchResults: searchResults.map((r) => ({ memory: r.memory, metadata: r.metadata })),
  })

  const userMemories =
    mode !== "query"
      ? convertProfileToMarkdown({
        profile: {
          static: deduplicated.static,
          dynamic: deduplicated.dynamic,
        },
      })
      : ""

  const generalSearchMemories =
    mode !== "profile" && deduplicated.searchResults.length
      ? [
        "Search results for the user's recent message:",
        ...deduplicated.searchResults.map((m) => `- ${m}`),
      ].join("\n")
      : ""

  return formatMemoriesForPrompt(
    {
      userMemories,
      generalSearchMemories,
    },
    promptTemplate,
  )
}
```

---

## 9. `MemoryCache`

A simple per-turn in-memory cache.

```ts
export class MemoryCache<T = string> {
  private cache = new Map<string, T>()

  static makeTurnKey(
    containerTag: string,
    threadId: string | undefined,
    mode: MemoryMode,
    message: string,
  ): string {
    const normalizedMessage = message.trim().replace(/\s+/g, " ")
    return `${containerTag}:${threadId || ""}:${mode}:${normalizedMessage}`
  }

  get(key: string): T | undefined {
    return this.cache.get(key)
  }

  set(key: string, value: T): void {
    this.cache.set(key, value)
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}
```

### Why this matters

During one model turn, tool loops or retries may repeatedly ask for the same memory context.
Cache it once and stop wasting work.

### Important note

This is only in-memory and process-local.
For a distributed server deployment, use Redis or another shared cache layer if needed.

---

## 10. `injectMemoriesIntoParams`

Pure helper for prompt injection.

```ts
import type { LanguageModelCallOptions } from "ai"

export function injectMemoriesIntoParams(
  params: LanguageModelCallOptions,
  memories: string,
): LanguageModelCallOptions
```

### Behavior

* if a system prompt exists, append memory text
* otherwise create a system prompt and prepend it
* do not mutate the input

### Reference implementation

```ts
export function injectMemoriesIntoParams(
  params: LanguageModelCallOptions,
  memories: string,
): LanguageModelCallOptions {
  const systemPromptExists = params.prompt.some(
    (prompt) => prompt.role === "system",
  )

  if (systemPromptExists) {
    const newPrompt = params.prompt.map((prompt) =>
      prompt.role === "system"
        ? { ...prompt, content: `${prompt.content}\n\n${memories}` }
        : prompt,
    )
    return { ...params, prompt: newPrompt }
  }

  return {
    ...params,
    prompt: [{ role: "system", content: memories }, ...params.prompt],
  }
}
```

---

## 11. `filterOutInjectedMemories`

If you auto-save a conversation after the model responds, do not re-save memory text that you injected into the prompt
earlier.

That causes recursive sludge.

```ts
export function filterOutInjectedMemories(content: string): string {
  return content.split("User Memories:")[0]
}
```

You may want a more robust marker-based approach later, but this is enough to start.

---

## 12. `saveMemoryAfterResponse`

Optional persistence after a model answer.

```ts
import type { LanguageModelCallOptions } from "ai"

export interface SaveMemoryAfterResponseParams {
  repository: MemoryRepository
  containerTag: string
  conversationId?: string
  assistantResponseText: string
  params: LanguageModelCallOptions
}

export async function saveMemoryAfterResponse(
  input: SaveMemoryAfterResponseParams,
): Promise<void>
```

### Behavior

* if `conversationId` exists, persist the whole conversation transcript via `addConversation`
* otherwise persist a simple user + assistant exchange via `addMemory`

### Suggested logic

```ts
export async function saveMemoryAfterResponse(
  input: SaveMemoryAfterResponseParams,
): Promise<void> {
  const {
    repository,
    containerTag,
    conversationId,
    assistantResponseText,
    params,
  } = input

  const promptMessages = params.prompt
    .filter((p) => p.role !== "system")
    .map((p) => ({
      role: p.role,
      content:
        typeof p.content === "string" ? filterOutInjectedMemories(p.content) : "",
    }))

  if (conversationId) {
    await addConversation(repository, {
      conversationId,
      containerTags: [containerTag],
      messages: [
        ...promptMessages,
        { role: "assistant", content: assistantResponseText },
      ],
    })
    return
  }

  const lastUserMessage = [...promptMessages]
    .reverse()
    .find((m) => m.role === "user")?.content

  if (!lastUserMessage?.trim()) return

  await addMemory(repository, {
    content: `User: ${lastUserMessage}\n\nAssistant: ${assistantResponseText}`,
    containerTags: [containerTag],
  })
}
```

---

## Vercel AI SDK Integration

This is the main integration point for the package.

You want a wrapper that automatically:

* fetches memory context
* injects it into prompts
* optionally saves new memory after generation

---

## `withMemory`

```ts
import type { LanguageModel } from "ai"

export interface WrapLanguageModelOptions {
  conversationId?: string
  mode?: "profile" | "query" | "full"
  addMemory?: "always" | "never"
  promptTemplate?: PromptTemplate
}

export function withMemory<T extends LanguageModel>(
  model: T,
  containerTag: string,
  repository: MemoryRepository,
  options?: WrapLanguageModelOptions,
): T
```

### Expected behavior

For `doGenerate` and `doStream`:

1. inspect the current params
2. determine the relevant user query text
3. build memory text
4. cache by turn key
5. inject into prompt
6. call the wrapped model
7. optionally save the final conversation/memory after response

---

## Suggested internal context object

```ts
interface MemoryMiddlewareContext {
  repository: MemoryRepository
  containerTag: string
  conversationId?: string
  mode: MemoryMode
  addMemory: "always" | "never"
  promptTemplate?: PromptTemplate
  memoryCache: MemoryCache<string>
}
```

---

## `transformParamsWithMemory`

This is the middleware workhorse.

```ts
export async function transformParamsWithMemory(
  params: LanguageModelCallOptions,
  ctx: MemoryMiddlewareContext,
): Promise<LanguageModelCallOptions>
```

### Behavior

* extract the most recent user message
* if mode requires a query and none exists, skip
* build a turn cache key
* reuse cached memory text when possible
* otherwise call `buildMemoriesText`
* inject memory text into params

### Suggested shape

```ts
export async function transformParamsWithMemory(
  params: LanguageModelCallOptions,
  ctx: MemoryMiddlewareContext,
): Promise<LanguageModelCallOptions> {
  const userMessage = getLastUserMessage(params)

  if (ctx.mode !== "profile" && !userMessage) {
    return params
  }

  const turnKey = MemoryCache.makeTurnKey(
    ctx.containerTag,
    ctx.conversationId,
    ctx.mode,
    userMessage || "",
  )

  const cached = ctx.memoryCache.get(turnKey)
  if (cached) {
    return injectMemoriesIntoParams(params, cached)
  }

  const memories = await buildMemoriesText({
    containerTag: ctx.containerTag,
    queryText: ctx.mode === "profile" ? "" : userMessage || "",
    mode: ctx.mode,
    repository: ctx.repository,
    promptTemplate: ctx.promptTemplate,
  })

  ctx.memoryCache.set(turnKey, memories)

  return injectMemoriesIntoParams(params, memories)
}
```

---

## Minimal helper utilities

You will need a couple of helpers.

```ts
export function getLastUserMessage(params: LanguageModelCallOptions): string | undefined {
  const reversed = [...params.prompt].reverse()
  const lastUser = reversed.find((p) => p.role === "user")
  return typeof lastUser?.content === "string" ? lastUser.content : undefined
}
```

That is enough for a first pass.
Do not over-engineer the archaeology of prompt contents on day one.

---

## Recommended Public Exports

Your `packages/memory/src/index.ts` should export only the useful surface area.

```ts
export * from "./types"
export * from "./repository"
export * from "./store"
export * from "./conversations"
export * from "./search"
export * from "./dedupe"
export * from "./cache"
export * from "./prompt-builder"
export * from "./middleware"
export * from "./vercel"
```

### Stable public API to aim for

```ts
addMemory
addConversation
searchMemories
getProfileMemories
deduplicateMemories
convertProfileToMarkdown
formatMemoriesForPrompt
buildMemoriesText
MemoryCache
injectMemoriesIntoParams
filterOutInjectedMemories
saveMemoryAfterResponse
withMemory
```

That is enough.
Do not expose random DB plumbing unless you enjoy breaking changes.

---

## Suggested Usage in an App

```ts
import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { withMemory } from "@repo/memory"
import { dbMemoryRepository } from "@repo/db-memory-repository"

const model = withMemory(
  openai("gpt-5"),
  "user_123",
  dbMemoryRepository,
  {
    conversationId: "thread_abc",
    mode: "full",
    addMemory: "always",
  },
)

const result = await generateText({
  model,
  messages: [
    {
      role: "user",
      content: "What am I currently building?",
    },
  ],
})
```

---

## Suggested Tool Layer for Agents

If you want agent tools alongside automatic middleware, expose tools like this:

```ts
export function createMemoryTools(
  repository: MemoryRepository,
  containerTags: string[],
) {
  return {
    searchMemories: tool({
      description: "Search relevant remembered facts and context.",
      inputSchema: z.object({
        informationToGet: z.string(),
        includeFullDocs: z.boolean().optional().default(false),
        limit: z.number().optional().default(10),
      }),
      execute: async ({ informationToGet, includeFullDocs = false, limit = 10 }) => {
        return searchMemories(repository, {
          informationToGet,
          containerTags,
          includeFullDocs,
          limit,
        })
      },
    }),

    addMemory: tool({
      description: "Store a new memory for later use.",
      inputSchema: z.object({
        memory: z.string(),
      }),
      execute: async ({ memory }) => {
        return addMemory(repository, {
          content: memory,
          containerTags,
        })
      },
    }),
  }
}
```

### Opinion

This is useful, but do not confuse tool-based memory with wrapper-based memory.

* wrapper-based memory = automatic context injection
* tool-based memory = explicit agent control

Support both, but keep them separate.

---

## Practical Defaults

Use these defaults unless you have a real reason not to.

### Retrieval mode default

```ts
"profile"
```

This is safer and more stable than query-only memory.

### Persistence default

```ts
"never"
```

Auto-saving everything by default is how you accumulate nonsense.

### Prompt template default

```plain text
User Memories:
## Static Profile
- ...
## Dynamic Profile
- ...

Search results for the user's recent message:
- ...
```

### Conversation custom ID

```plain text
conversation:{conversationId}
```

This gives you idempotent upserts.

---

## Implementation Notes

### 1. Static vs dynamic memory is worth keeping

Do not flatten everything into one bag.
That makes prompt construction worse and memory quality noisier.

### 2. Provenance is not optional

Keep document links for memory entries.
Without provenance, debugging memory quality becomes miserable.

### 3. Versioning beats destructive updates

When a memory changes, prefer:

* create a new version
* mark old one not latest
* link them

This preserves history and enables context chains.

### 4. Inference should be flagged

Do not present inferred memory with the same confidence as explicit user-provided memory.

### 5. Per-turn cache should stay simple

A plain `Map` is enough inside one request lifecycle.

### 6. Keep the package sync-free at the boundary

The package should expose async functions, but avoid hidden background jobs.
If memory extraction is asynchronous in your system, surface that intentionally elsewhere.

---

## What This Package Should Not Do

To keep the package clean, do not put these inside it:

* REST route definitions
* auth and session handling
* OAuth providers
* file upload endpoints
* UI state
* analytics dashboards
* queue workers
* cron cleanup logic
* vendor-specific API clients unrelated to memory orchestration

This package is the memory brain, not the whole organism.

---

## MVP Checklist

If you want the first useful version, build these in order:

### Phase 1

* `MemoryRepository` interface
* `addMemory`
* `addConversation`
* `searchMemories`
* `getProfileMemories`
* `deduplicateMemories`
* `convertProfileToMarkdown`
* `buildMemoriesText`
* `injectMemoriesIntoParams`
* `MemoryCache`
* `withMemory`

### Phase 2

* `saveMemoryAfterResponse`
* `filterOutInjectedMemories`
* memory versioning support
* provenance links from memory to documents

### Phase 3

* TTL / forgetting
* inference confidence policies
* richer ranking and re-ranking
* distributed cache
* partial memory compression / summarization

That sequencing matters. Build the useful thing first. Fancy architecture before real usage is just decorative
overthinking.

---

## Final Recommended Mental Model

Think of the system as three layers:

### Storage layer

Documents, chunks, memory entries, spaces, joins.

### Retrieval layer

Profile fetch, semantic search, dedupe, formatting.

### LLM integration layer

Prompt injection, turn cache, automatic save-after-response, tool exposure.

That is the clean boundary.

If you keep those layers separate, this package will stay maintainable.
If you blur them together, it will slowly mutate into a swamp beast.

---

## Summary

Build a `packages/memory` library that:

* depends on a repository interface
* stores raw documents and extracted memory entries
* supports spaces/container tags for scoping
* exposes profile and search retrieval
* deduplicates across static, dynamic, and search memories
* builds clean prompt text
* injects that text into Vercel AI SDK model calls
* optionally persists new conversation memory after responses
* uses a per-turn cache to avoid repeated lookups

That is the right minimal architecture for a monorepo memory system.

Nothing more is required to get a solid first version running.
Quite a lot less will become annoying very quickly.

```
