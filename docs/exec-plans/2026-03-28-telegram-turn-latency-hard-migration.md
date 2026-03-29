# Telegram Turn Latency Hard Migration

## Purpose / outcome

Replace the old Telegram turn handling with a single clean architecture:

- direct webhook ingress
- adaptive buffering in `ConversationSession`
- DO-owned active unsaved turn state
- token-aware workflow execution
- atomic first-outbound claiming
- no Telegram queue ingress path

User-visible outcomes:

- single Telegram messages start faster
- quick bursts still batch
- narrow pre-first-outbound corrections supersede correctly
- stale runs cannot send visible Telegram output
- workflow retries cannot duplicate user-visible output

## Scope

- `apps/api/src/worker.ts`
- `packages/channels/src/telegram/chat-sdk.ts`
- `apps/api/src/durable-objects/conversation-session.ts`
- `apps/api/src/durable-objects/conversation-session-state.ts`
- `apps/api/src/workflows/agent-execution.ts`
- `apps/api/src/workflows/telegram-delivery.ts`
- Worker bindings, Wrangler config, and runtime naming cleanup
- Telegram runtime docs and repo-facing docs
- tests for state transitions and delivery gating

## Non-goals

- backwards compatibility with Telegram queue ingress
- workflow polling
- workflow event interrupts for Telegram follow-ups
- broad NLP-style follow-up classification

## Architecture impact

- Telegram ingress is now documented and implemented as direct webhook to Chat SDK to Durable Object to workflow.
- `ConversationSession` owns both pending buffered input and the active unsaved turn.
- `AgentExecutionWorkflow` must claim first outbound before the first visible send.
- Telegram normal-text ingress no longer resolves identity in the Chat SDK hot path.
- Telegram queue bindings, types, and worker entrypoints are removed.

## Milestones

### 1. Remove legacy Telegram queue architecture

- remove the Worker queue handler
- remove the legacy Telegram queue message type
- remove the old Telegram queue bindings
- delete the queue consumer
- rename the Worker runtime module into `src/runtime/worker-runtime.ts`

### 2. Ship adaptive debounce and active-turn preservation

- add `bufferStartedAt`, `debounceDeadlineAt`, `lastBufferedAt`
- add `inFlightMessages`, `activeExecutionToken`, `firstOutboundClaimedAt`, `supersededAt`
- make the DO preserve the drained active turn until token-aware completion

### 3. Add atomic first-outbound claiming

- add `claimFirstOutbound(executionToken)`
- gate first visible workflow send paths through the claim
- suppress stale and superseded visible output

### 4. Make follow-up handling deterministic

- narrow correction prefixes only
- supersede only before first outbound
- otherwise queue for the next turn

### 5. Update docs and harness

- rewrite Telegram runtime docs to match the shipped path
- add pure state and delivery tests
- keep visible-side-effect retries out of the workflow step that can send to Telegram

## Exact files / modules changed

- `apps/api/src/worker.ts`
- `apps/api/src/runtime/worker-runtime.ts`
- `apps/api/src/durable-objects/conversation-session.ts`
- `apps/api/src/durable-objects/conversation-session-state.ts`
- `apps/api/src/durable-objects/conversation-session.test.ts`
- `apps/api/src/workflows/agent-execution.ts`
- `apps/api/src/workflows/agent-execution.test.ts`
- `apps/api/src/workflows/telegram-delivery.ts`
- `apps/api/src/workflows/sandbox-provision.ts`
- `apps/api/src/workflows/volume-provision.ts`
- `apps/api/src/handlers/reconciliation.ts`
- `packages/channels/src/index.ts`
- `packages/channels/src/telegram/chat-sdk.ts`
- `packages/channels/src/telegram/index.ts`
- `packages/channels/src/telegram/utils.ts`
- `packages/env/src/workers.ts`
- `apps/api/wrangler.toml`
- `README.md`
- `apps/api/README.md`
- `docs/RUNTIME.md`
- `docs/CHANNELS.md`
- `docs/channels/telegram.md`

## Commands

```sh
bun run --filter @amby/api test
bun run --filter @amby/api typecheck
bun run --filter @amby/channels test
rg -n "legacy Telegram queue|telegram.*queue" apps packages docs README.md
```

## Acceptance checks

- a single Telegram message starts after the adaptive debounce, not a fixed 3 second wait
- normal text ingress does not resolve Telegram identity before the DO hop
- a superseded rerun includes the original unsaved turn plus the correction
- stale `completeExecution` calls cannot clear a newer active run
- stale or superseded runs cannot send relink, progress, final, or pre-output error messages
- after first outbound is claimed, later follow-ups queue instead of superseding
- workflow retries do not duplicate visible Telegram delivery
- no legacy Telegram queue ingress docs or bindings remain

## Progress log

- confirmed production ingress is direct webhook to Chat SDK to DO to workflow
- removed Telegram queue handler, queue consumer, queue bindings, and queue message type
- renamed the Worker runtime module out of the old queue namespace
- removed normal-text `resolveTelegramUser()` from the Chat SDK hot path
- extracted pure `ConversationSession` state helpers into `conversation-session-state.ts`
- rewrote `ConversationSession` as a thin DO wrapper over the pure state machine
- added token-aware `claimFirstOutbound` and `completeExecution` handling
- extracted pure Telegram delivery gating into `telegram-delivery.ts`
- removed retries from the user-visible workflow step
- added pure state and delivery tests
- rewrote runtime and Telegram docs to match the final architecture

## Surprises / discoveries

- the repo still described a queue-based Telegram ingress path even though production code no longer used it
- the DO previously emitted workflow events for follow-ups, but the workflow never consumed them
- preserving the active unsaved turn in DO state is mandatory because user messages are persisted only after turn completion
- Bun tests could not import modules that directly depend on `cloudflare:workers`, which made pure helper extraction the right harness fix

## Decision log

- hard migration only; no queue fallback retained
- no workflow polling
- no workflow event-interrupt path for Telegram
- narrow deterministic correction prefixes only
- first visible Telegram delivery is controlled by atomic DO state, not by in-workflow heuristics
- retries remain only on the user-resolution step

## Retrospective

- compare `webhook -> workflow start` and `workflow start -> first outbound claimed`
- watch supersede counts, stale-send suppression counts, and duplicate-delivery incidents
- if compute before first outbound still dominates latency, evaluate cancellation separately with the new clean state model already in place
