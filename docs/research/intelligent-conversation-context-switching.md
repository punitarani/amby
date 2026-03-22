# Thread Routing for Conversation Context Switching

Amby's conversations span hours or days across multiple unrelated subjects. The current architecture loads the last 20 messages regardless of relevance — a sliding window that pollutes the context window with irrelevant history, wastes tokens, and loses reasoning continuity when users revisit earlier threads.

This document defines a **thread router**: an online function that, given an inbound turn (or Telegram batch), picks exactly one active thread or creates a new one, then assembles a context window containing only that thread's bounded artifacts plus stable global memory. The design prioritizes simplicity, minimal code, and production correctness on Telegram — with channel-agnostic extensibility later.

---

## Table of Contents

1. [The Problem](#the-problem)
2. [Research Grounding](#research-grounding)
3. [Current Architecture](#current-architecture)
4. [Design](#design)
5. [Implementation](#implementation)
6. [Evaluation](#evaluation)
7. [Summary](#summary)

---

## The Problem

A user's conversation with Amby across a day:

```
[08:00] User: "what meetings do I have today"
[08:01] Amby: "you've got standup at 9, 1:1 with sarah at 11, and the client call at 2"
[08:02] User: "can you prep a summary for the client call"
[08:05] Amby: "here's a one-pager on where the acme proposal stands..."
[10:30] User: "hey can you look up flights to miami for next weekend"
[10:32] Amby: "found a few options. direct on AA for $340..."
[10:45] User: "actually what did sarah want to talk about in the 1:1?"
[14:20] User: "how did the client call go?"
[14:21] User: "also book the AA flight"
```

When the user asks "how did the client call go?" at 14:20, the optimal context includes the meeting prep exchange from 08:00-08:05 but not the flight search from 10:30-10:32. The current system cannot distinguish between the two — it loads whatever falls into the last-20 window.

### What goes wrong

**Context pollution.** Irrelevant messages degrade response quality. A focused 300-token context often outperforms an unfocused 113,000-token context.

**Lost in the Middle.** LLMs drop 30%+ accuracy when key information sits in the middle of the context window (Liu et al., TACL 2024). This is architectural — RoPE-based attention creates stronger signals at the beginning and end. When relevant messages are buried among irrelevant ones, the model struggles to surface them.

**Multi-turn degradation.** A 39% average performance drop when instructions are delivered across multiple turns versus a single turn. When LLMs take a wrong conversational path — e.g., confusing flight context with meeting context — they do not self-correct.

**Lost artifacts.** When Amby delegates to a subagent that runs thousands of tokens of tool calls, only a condensed summary returns to the orchestrator. The `tool_calls` and `tool_results` columns in the messages table exist but `saveMessage()` never populates them — that data is logged to Braintrust traces and then discarded. If the user revisits the thread later, Amby can only work from the text summary.

**Wasted tokens.** Every irrelevant message burns tokens from a finite budget. For conversations persisting days or weeks, this compounds into both cost and quality problems.

---

## Research Grounding

The design is informed by three research threads. This section is deliberately concise — the goal is to establish *why* thread routing works, not to survey the field.

### Thread isolation improves quality more than compression

**ContextBranch** (arxiv 2512.13914, Dec 2025) applies version-control primitives to LLM conversations: checkpoint, branch, switch, and inject. Results: **58.1% context size reduction** and **2.5% quality improvement**. The quality gain comes from isolation — keeping each branch's context focused — not from compressing more aggressively. ContextBranch requires explicit user action to branch/switch; our router automates this transparently.

### Simple masking beats expensive summarization

**JetBrains Research** (Dec 2025) found that observation masking — replacing older tool observations with placeholders — matched or exceeded LLM summarization in agent benchmarks, while cutting costs 50%+. Summarization caused agents to run 15% longer and obscured stop signals. The lesson: use deterministic, cheap strategies first. Only add LLM-based processing where it demonstrably helps.

### Segmentation F1 is the wrong optimization target

Recent evaluation work (arxiv 2512.17083) argues that dialogue topic segmentation "does not admit a single ground-truth boundary set" — reported gains can be dominated by boundary-density mismatches rather than meaningful improvements. Optimizing segmentation accuracy is the wrong goal. The right goal is downstream response quality: does the assembled context produce better answers?

### Existing frameworks don't solve this

Anthropic's context engineering framework (compaction, note-taking, multi-agent isolation) and LangChain's memory types (buffer, summary buffer, vector store) all operate chronologically. None implement real-time thread detection with selective context loading. The closest prior art — Slack and Discord threads — requires explicit user action to create threads.

---

## Current Architecture

### Message storage

Conversations and messages in Postgres via Drizzle ORM (`packages/db/src/schema/conversations.ts`):

```
conversations { id, userId, channelType, title, metadata, createdAt, updatedAt }
messages      { id, conversationId, role, content, toolCalls, toolResults, metadata, createdAt }
```

The `toolCalls` and `toolResults` columns exist in the schema but `saveMessage()` only writes `{ conversationId, role, content, metadata }` — tool artifacts are discarded after each request.

### Context loading

`loadHistory` in `packages/agent/src/agent.ts` pulls the last 20 messages by recency, reverses them, and filters to `user`/`assistant` roles:

```ts
const loadHistory = (conversationId: string) =>
  query((d) =>
    d.select({ role: schema.messages.role, content: schema.messages.content })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(20)
  ).pipe(
    Effect.map((rows) =>
      rows.reverse().filter((r) => r.role === "user" || r.role === "assistant")
    )
  )
```

This is a pure recency window. No relevance selection, no topic awareness, no thread structure.

### Context assembly

`prepareContext()` builds the orchestrator's full context:

1. Load user timezone → format datetime
2. Load memory profile (`memory.getProfile(userId)`) → deduplicate → format as markdown
3. Load last 20 messages
4. Build system prompt with memory context appended
5. Create tool set (subagent delegation tools + direct tools)

The LLM receives `[...history, ...requestMessages]` — a flat chronological list.

### Memory system

Separate from conversation history. Stores distilled facts (static: "user lives in SF", dynamic: "user is planning a Miami trip") in a `memories` table. Retrieval is keyword-based substring matching — `search_memories` lowercases the query, runs `.includes()` across all memories, and returns up to 10 matches (or the first 10 if nothing matches). Not semantic. Not thread-aware. Memory and threading are separate problems with separate failure modes — they stay separate in this design.

### Model

The runtime model is `google/gemini-3.1-flash-lite-preview` via OpenRouter (`packages/models/src/registry.ts`). This is a small, fast, cheap model — the same provider can serve both the main agent and the routing call without introducing a second inference dependency.

### Production message flow (Telegram)

Messages flow through the Chat SDK (`@chat-adapter/telegram`) → Durable Object (per-chat, 3-second debounce) → Workflow (durable agent execution). The Durable Object buffers rapid messages and drains them as a batch to the workflow. The workflow calls `handleBatchedMessages()` when multiple buffered messages exist. This debounce batch is the natural unit for thread routing — one routing decision per batch, not per message.

### What's unused

| Asset | Status | Opportunity |
|---|---|---|
| `messages.toolCalls` column | Schema exists, never written | Store tool artifacts without new tables |
| `messages.toolResults` column | Schema exists, never written | Store subagent summaries without new tables |
| `messages.metadata` column | Written but minimal | Store `threadId`, router decision |
| `onStepFinish` lifecycle callback | Collects tool names for traces | Can collect structured artifact data |
| Braintrust `ToolLoopAgent` result | Has `.toolResults` array | Source for artifact persistence |

---

## Design

### Three invariants

These are the design rails that keep the implementation small:

**1. The router picks exactly one thread per inbound turn.** Given a message (or Telegram batch), the router selects one active thread ID or creates a new one, biasing toward continuity. One routing decision per request, not one per sentence.

**2. A thread is a bounded state bundle, not an unbounded transcript.** Each thread contains: a compact synopsis, a tail of raw turns (bounded by a message count), and a tail of replayable artifacts (tool outputs, subagent summaries). If a thread's raw history exceeds the tail budget, oldest messages are trimmed — the synopsis carries forward the compressed earlier context.

**3. Artifacts are a replayable evidence ledger, not reasoning traces.** The stable primitive is: what tools ran, what summaries were produced, what the agent concluded. This is model-agnostic and survives compaction. "Hidden reasoning traces" are not persisted — they're inconsistent across models and modes, and storing them creates a maintenance burden that doesn't pay for itself.

### Data model

One new table. One new column on messages. No `generation_contexts` table — artifacts go on the message row that already exists.

```sql
-- New table: threads within a conversation
CREATE TABLE conversation_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label           text,           -- "flight search", "meeting prep"
  synopsis        text,           -- rolling summary, updated on thread dormancy
  status          text NOT NULL DEFAULT 'open',  -- 'open' | 'archived'
  last_active_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX threads_conversation_active_idx
  ON conversation_threads(conversation_id, status, last_active_at DESC);

-- New column on messages: which thread this message belongs to
ALTER TABLE messages ADD COLUMN thread_id uuid REFERENCES conversation_threads(id);
CREATE INDEX messages_thread_idx ON messages(thread_id, created_at);
```

UUID thread IDs instead of integer topic counters because:
- They support archiving, merging, cross-channel references, and future explicit threading (reply-to) without sequence drift
- They're stable identifiers, not per-conversation bookkeeping
- They're consistent with every other ID in the schema

Artifacts are persisted by extending `saveMessage()` to write `toolCalls` and `toolResults` — the columns already exist and are already typed as jsonb.

### Router

#### Heuristic-first, model-fallback

The router runs once per inbound turn (or once per Telegram batch). Most messages continue the current thread. The heuristic stage handles these at zero latency cost.

```ts
interface RouteDecision {
  action: "continue" | "switch" | "new"
  threadId: string       // existing thread ID, or new UUID for "new"
  label?: string         // label for new threads
  confidence: number
}

function routeMessage(
  message: string,
  lastThreadId: string,
  lastMessageAt: Date,
  openThreads: Array<{ id: string; label: string; synopsis: string }>,
): RouteDecision | null {
  // Heuristic 1: Short time gap → continue
  const gapMs = Date.now() - lastMessageAt.getTime()
  if (gapMs < 120_000) {
    return { action: "continue", threadId: lastThreadId, confidence: 0.85 }
  }

  // Heuristic 2: Explicit reference to a thread label
  const msgLower = message.toLowerCase()
  for (const thread of openThreads) {
    if (thread.label && msgLower.includes(thread.label.toLowerCase())) {
      return { action: "switch", threadId: thread.id, confidence: 0.80 }
    }
  }

  // No heuristic match → fall through to model
  return null
}
```

When heuristics return null, a model call classifies the message. The default model (`gemini-3.1-flash-lite-preview`) is already cheap and fast — no second provider needed.

```ts
async function routeWithModel(
  model: LanguageModel,
  message: string,
  openThreads: Array<{ id: string; label: string; synopsis: string }>,
): Promise<RouteDecision> {
  // Structured output: the model returns JSON with action, thread index, label
  const result = await generateObject({
    model,
    schema: routeDecisionSchema,
    prompt: buildRouterPrompt(message, openThreads),
  })
  return mapToRouteDecision(result, openThreads)
}
```

The router prompt is small: one line per open thread (label + synopsis), plus the new message. Candidate set is capped at 10 most recently active open threads.

#### Bias toward continuity

The router defaults to "continue current thread" because:
- It's the most common case (users usually keep talking about the same thing)
- False-new-thread is worse than false-continuation. A false new thread causes a perceived memory failure ("I already told you about the flight"). A false continuation loads some irrelevant context but doesn't lose anything.
- The Microsoft multi-turn study confirms that wrong conversational paths compound — getting the thread right on the first try matters more than perfect boundary detection.

### Context assembly

Replace the current `loadHistory` with thread-aware packing:

```
[system prompt]                           — stable, ~1500 tokens
[user memory profile]                     — as today, static + dynamic facts
[other open threads: label + synopsis]    — 1-2 lines each, peripheral awareness
[thread synopsis]                         — if thread has been dormant, load its synopsis
[thread artifact recap]                   — last few high-signal tool outputs from this thread
[thread message tail]                     — last K messages in this thread (user + assistant)
[new inbound message(s)]                  — current turn
```

This layout exploits the "Lost in the Middle" effect: stable context (system prompt, memory) goes first; the thread's raw messages go last, closest to the new message where attention is strongest. The synopsis and artifact recap sit in between as a bridge.

#### Token budget

| Component | Budget | Notes |
|---|---|---|
| System prompt | ~1,500 | Fixed |
| Memory profile | ~500 | All active memories for this user |
| Other thread summaries | ~200 | 1-2 sentences per open thread, capped at 5 |
| Thread synopsis | ~200 | Only if thread was dormant |
| Artifact recap | ~300 | Last 3-5 high-signal artifacts from this thread |
| Thread message tail | Remaining | Raw messages, oldest trimmed first |

Token estimation uses `content.length / 4` — rough but sufficient. The goal is preventing overflows, not packing every last token.

### Thread lifecycle

```
new → open → archived
       ↑        |
       +--------+ (re-opened by router)
```

- **Open**: actively being discussed or recently active. Synopsis may be empty (not yet dormant).
- **Archived**: no activity for 24 hours, or user explicitly closed ("thanks, that's done"). Has a synopsis.

When a thread transitions from open to archived, a synopsis is generated. When the router switches back to an archived thread, it is re-opened and its synopsis is loaded into the context as a bridge.

Synopsis generation triggers:
- Thread goes dormant (no messages for >1 hour while another thread is active)
- Thread is archived (>24 hours idle)
- Thread message count exceeds the tail budget (synopsis captures what the tail no longer holds)

Synopsis generation uses the same default model with a simple prompt: "Summarize this thread in 2-3 sentences. Focus on: what the user wanted, what was done, and any outstanding items."

### Artifact persistence

Extend `saveMessage()` to write tool artifacts on the assistant message row:

```ts
const saveMessage = (
  conversationId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  opts?: {
    metadata?: Record<string, unknown>
    threadId?: string
    toolCalls?: unknown[]
    toolResults?: unknown[]
  },
) =>
  query((d) =>
    d.insert(schema.messages).values({
      conversationId,
      role,
      content,
      threadId: opts?.threadId,
      metadata: opts?.metadata,
      toolCalls: opts?.toolCalls,
      toolResults: opts?.toolResults,
    })
  )
```

The `ToolLoopAgent` result already exposes `.toolResults` — an array of `{ output }` objects. The `onStepFinish` callback receives `toolCalls` per step. Capture both and write them to the columns that already exist.

For artifact replay during context assembly, select the last few assistant messages in the thread that have non-null `toolResults`, extract delegate summaries and key tool outputs, and format them as a compact recap:

```
## Thread context (meeting prep)
- Researched Acme proposal: found draft from 2 weeks ago, contact john@acme.com
- Built one-pager with proposal status, open items, recommended talking points
```

No extra LLM call needed — this is deterministic extraction from structured data already in the DB.

---

## Implementation

Three increments, each independently shippable and valuable.

### Increment 1: Thread routing and thread-aware history

**Schema migration:**
- Create `conversation_threads` table
- Add `thread_id` column to `messages`

**Default thread behavior:**
- On first message in a conversation, create a default thread and route there
- All existing messages (without `thread_id`) are treated as belonging to the default thread via a `COALESCE` in queries

**Router:**
- Implement `routeMessage()` heuristics + `routeWithModel()` fallback
- Run once per request inside `handleMessage` / `handleBatchedMessages`, before `prepareContext`
- Store the `threadId` on every message

**Thread-aware `loadHistory`:**
```ts
const loadThreadTail = (conversationId: string, threadId: string, limit = 20) =>
  query((d) =>
    d.select({ role: schema.messages.role, content: schema.messages.content })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.threadId, threadId),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit)
  ).pipe(
    Effect.map((rows) =>
      rows.reverse().filter(
        (r): r is { role: "user" | "assistant"; content: string } =>
          r.role === "user" || r.role === "assistant"
      )
    )
  )
```

**Telegram integration:** The workflow already calls `handleMessage` or `handleBatchedMessages`. Route once per workflow execution — the Durable Object's debounce batch is the natural routing unit. The router runs inside the workflow step, not in the DO.

**Tracing:** Extend the existing Braintrust trace metadata with `threadId`, router decision (`action`, `confidence`), and thread message count. This gives before/after baselines without a new observability system.

### Increment 2: Artifact persistence

**Extend `saveMessage`** to accept and write `toolCalls`, `toolResults`, and `threadId`.

**Capture artifacts** from the `ToolLoopAgent` result:
- `result.toolResults` for subagent delegate summaries and tool outputs
- `onStepFinish` callback for per-step tool call names

**Artifact recap in context assembly:** When loading a thread's tail, also select the last 3-5 assistant messages with non-null `toolResults`, extract high-signal entries (delegate summaries, key tool outputs), and format as a compact text block injected before the message tail.

### Increment 3: Synopsis and thread lifecycle

**Synopsis generation** on thread dormancy and archival. Uses the default model with a 2-3 sentence summarization prompt.

**Lifecycle management:**
- Background check: threads with no activity for 24 hours are archived
- Synopsis update: triggered on dormancy (1 hour idle while another thread is active) and archival
- Re-opening: when the router switches to an archived thread, set status back to open

**Other-thread awareness:** Load synopses of other open threads and include as 1-2 line summaries in the context, giving the model peripheral awareness without full history.

### Where each increment touches the code

| File | Increment 1 | Increment 2 | Increment 3 |
|---|---|---|---|
| `packages/db/src/schema/` | New `threads.ts`, add `threadId` to messages | — | — |
| `packages/agent/src/agent.ts` | Add router call, modify `loadHistory` → `loadThreadTail`, pass `threadId` to `saveMessage` | Extend `saveMessage` to write `toolCalls`/`toolResults`, capture from result | Add synopsis generation, thread lifecycle checks |
| `packages/agent/src/router.ts` | New file: `routeMessage`, `routeWithModel`, `buildRouterPrompt` | — | — |
| `apps/api/src/workflows/agent-execution.ts` | Pass routing through to `handleMessage` | — | — |

### What this does NOT include

- **Multi-thread messages.** "Book the flight and remind me about the meeting" spans two threads. V1 picks the dominant thread. This is acceptable — the router biases toward the more recent reference, and the model can still access the other thread's context via `search_memories` if needed.
- **Thread merging.** Two threads that turn out to be one topic are not merged. They coexist. If this becomes a real problem, it's an incremental addition later.
- **Retroactive reclassification.** Wrong thread assignments are not fixed after the fact. The router's continuity bias minimizes these, and the cost of background reclassification doesn't justify itself in v1.
- **Semantic memory search.** Thread routing and semantic memory retrieval are orthogonal improvements. Memory stays keyword-based for now.

---

## Evaluation

### Metrics

**Thread routing accuracy:** Log every router decision (action, threadId, confidence) to Braintrust traces. Manually label a sample of 100+ multi-topic conversations. Measure precision/recall for `continue` vs `switch` vs `new` decisions.

**Response quality on thread resumption:** The primary product metric. When a user returns to a dormant thread, does Amby correctly recall and build on prior context? Compare error rates (wrong information, re-asking for context the user already provided) before and after threading.

**Token efficiency:** Measure the ratio of thread-relevant to total tokens in the context window. Thread-aware loading should show higher signal-to-noise than the current recency window.

**User re-explanation rate:** Track messages where the user corrects Amby or re-states context ("I already told you about the flight"). This should decrease with threading.

### Validation approach

Run both systems in parallel for an evaluation period. For each inbound message, route to a thread and assemble a thread-aware context. Compare the thread-aware response against the recency-window response using an LLM-as-judge on a rubric of relevance, accuracy, and coherence. Use the default model for judging to keep costs low.

---

## Summary

Amby's conversations are long-lived and multi-topic. The current architecture loads the last 20 messages regardless of relevance. This causes context pollution, wastes tokens, and produces worse responses when users switch between subjects.

The solution is a **thread router** — not a topic segmentation framework. The router picks one thread per inbound turn using cheap heuristics (time gap, label matching) with a model fallback for ambiguous cases. Context assembly loads only that thread's bounded tail plus global memory, with synopses of other threads for peripheral awareness. Tool artifacts are persisted on the message rows that already exist in the schema, enabling deterministic replay without extra tables or LLM summarization calls.

Three design invariants keep the implementation small:
1. One thread per turn, bias toward continuity
2. Threads are bounded state bundles (synopsis + message tail + artifact tail), not unbounded transcripts
3. Artifact persistence uses existing DB columns and structured extraction, not reasoning traces

Three increments, each independently valuable:
1. Thread routing + thread-aware history loading
2. Artifact persistence on message rows
3. Synopsis generation + thread lifecycle management

The bet: replacing "load the last 20 messages" with "load this thread's relevant context" produces measurably better responses for multi-topic conversations. ContextBranch's 58.1% context reduction and 2.5% quality improvement with explicit branching validates the thesis. Automating the branching via a router is the contribution.
