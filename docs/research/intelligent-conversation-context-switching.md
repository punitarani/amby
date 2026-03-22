# Thread Routing for Conversation Context Switching

This document captures the rationale behind Amby's thread-aware conversation model and the shape that actually shipped in this PR.

## The Problem

Amby's conversations are long-lived and multi-topic. A flat "last 20 messages" replay window causes three failures:

- irrelevant turns crowd out the right context
- prior delegated work becomes hard to recover from natural-language summaries alone
- dormant topics lose continuity when the user returns hours later

The fix is not full dialogue segmentation. It is a practical router that picks one active thread per inbound turn and loads only the context that matters for that thread.

## Research Grounding

Three ideas shaped the design:

- thread isolation matters more than raw compression
- deterministic replay beats expensive summarization where possible
- downstream response quality matters more than abstract segmentation scores

That led to a simple rule: bias toward continuity, keep context bounded, and replay only high-signal artifacts.

## What Shipped

### 1. Internal thread model

One platform conversation can now contain multiple internal topic threads.

The schema is:

```
conversations        → platform-level container
conversation_threads → internal topic threads
messages             → visible transcript
traces               → orchestrator/subagent execution tree
trace_events         → ordered tool-call and tool-result events
```

The important implementation decision: execution state did not go onto `messages`. It lives in `traces` and `trace_events`.

### 2. Thread resolution before prompt assembly

`resolveThread()` now runs before the orchestrator prompt is built.

Resolution order:

1. ensure the default thread exists
2. archive stale open threads older than 24 hours
3. use a native thread key if a channel provides one
4. otherwise use the derived router

Derived routing is intentionally simple:

- continue if the last message was under 2 minutes ago
- switch if a thread label matches by word boundary
- switch if at least 2 stored keywords match
- fall back to a structured model call for `continue`, `switch`, or `new`

Current CLI and Telegram request paths use the derived path.

### 3. Thread-aware context packing

The orchestrator no longer sees a flat conversation window. It sees:

1. stable system prompt
2. user memory
3. other open-thread summaries
4. resumed-thread synopsis when needed
5. recent thread artifact recap
6. active-thread message tail
7. current inbound message(s)

This keeps the relevant thread close to the current turn while still giving the model lightweight awareness of other active topics.

### 4. Selective execution replay

For follow-ups on prior work, the system replays recent execution summaries instead of raw traces.

- `loadThreadTail()` appends `[Tools used: ...]` annotations to the last 4 assistant messages
- `loadThreadArtifacts()` builds a compact `Thread context` block from recent `tool_result` events

The trace tables remain the source of truth. The prompt gets only the compressed parts that help with continuity.

### 5. Synopsis lifecycle

Thread synopses are generated when:

- the agent switches away from a thread that has been idle for more than 1 hour
- a thread is archived after 24 hours of inactivity
- the thread would overflow the 20-message replay tail

Each synopsis also produces 3-5 keywords. Those keywords feed back into routing.

## Why the Trace Tables Won

The original design direction considered storing tool artifacts on the assistant message row. That is not what shipped.

The trace-tree design won because:

- one assistant reply can contain many tool steps
- delegated subagents create nested execution
- event ordering matters
- prompt replay needs summaries, but debugging needs full fidelity

`messages` is now clean transcript storage. `traces` and `trace_events` are the execution ledger.

## Current Limits

- one inbound turn maps to one thread, even if the message spans multiple topics
- derived routing only considers open threads
- reply-chain routing is reserved but not wired yet
- native thread-key routing exists at the resolver API level, but current callers do not pass thread keys

These are deliberate constraints, not omissions by accident.

## Summary

The shipped design is smaller and cleaner than the original proposal:

- thread state lives in `conversation_threads`
- visible transcript stays in `messages`
- execution state lives in `traces` and `trace_events`

That split gives Amby what it needed most: thread continuity, compact replay, and a durable record of delegated work without dragging whole conversations back into every prompt.

