# Chat SDK DO State Plan

## Purpose

Replace the Worker Chat SDK memory state with a Cloudflare Durable Object-backed state adapter so production Telegram webhooks stop using transient in-memory subscriptions, locks, and caches.

## User-visible outcome

- Production Telegram webhook handling no longer emits the `MemoryStateAdapter is not recommended for production` warning.
- Chat SDK subscriptions, dedupe keys, locks, and message history persist through Worker isolate churn.
- Local Bun-only API development keeps the existing memory-backed behavior.

## Scope

- Add a Worker-only Durable Object-backed Chat SDK state adapter.
- Inject the new state adapter into the Worker `getOrCreateChat(...)` path.
- Register the new Durable Object in Wrangler config and Worker exports.
- Add targeted adapter contract tests.
- Update channel/runtime docs to reflect the new storage path.

## Non-goals

- No broader Chat SDK package upgrade.
- No attempt to move Bun local dev onto Durable Objects.
- No reuse of `ConversationSession` for Chat SDK state.
- No Cloudflare KV-based implementation.

## Architecture impact

- Keep Chat SDK state separate from `ConversationSession` so debounce/workflow orchestration and Chat SDK transport state do not share a schema or migration path.
- Keep Worker-only Durable Object code inside `apps/api` so shared channel code does not import `cloudflare:workers`.
- Make the shared `@amby/channels` Worker chat bootstrap accept an injected `StateAdapter` instead of constructing one internally.

## Milestones

1. Add the checked-in DO-backed adapter and Chat State DO.
2. Wire Worker chat initialization to the new adapter and register the DO with Wrangler.
3. Add adapter contract tests and update docs.
4. Run targeted tests, typechecks, lint, and a Worker-path smoke validation.

## Likely files to change

- `apps/api/src/chat-state/cloudflare-chat-state.ts`
- `apps/api/src/durable-objects/chat-state.ts`
- `apps/api/src/worker.ts`
- `apps/api/wrangler.toml`
- `packages/channels/src/telegram/chat-sdk.ts`
- `apps/api/package.json`
- `docs/CHANNELS.md`
- `apps/api/README.md`
- `docs/DEVELOPMENT.md`

## Commands

- `bun run --filter @amby/api test`
- `bun run --filter @amby/api typecheck`
- `bun run --filter @amby/channels test`
- `bun run --filter @amby/channels typecheck`
- `bun run lint`
- `bun run api:dev:worker`
- `bun run mock`

## Acceptance checks

- Worker Telegram webhook path uses the DO-backed Chat SDK state adapter instead of `createMemoryState()`.
- A new `CHAT_STATE` Durable Object binding exists and is exported from the Worker entrypoint.
- Local Bun API entrypoint remains memory-backed.
- Adapter contract tests cover subscription, lock, conditional-set, and list semantics.
- Worker smoke validation succeeds through `/telegram/webhook` without the production memory-state warning.
- `bun run --filter @amby/api test` passes.
- `bun run --filter @amby/api typecheck` passes.
- `bun run --filter @amby/channels test` passes.
- `bun run --filter @amby/channels typecheck` passes.
- `bun run lint` passes.

## Progress log

- 2026-03-27: Investigated the production warning source and confirmed it is emitted by `createMemoryState()` in the Worker Chat SDK bootstrap.
- 2026-03-27: Verified Cloudflare KV is not a safe fit for Chat SDK state semantics and chose a Durable Object-backed state path instead.
- 2026-03-27: Confirmed the existing community Durable Object adapter is not compatible with this repo's pinned `chat@4.20.2` interface, so the adapter will be implemented locally.
- 2026-03-27: Added the local Cloudflare Chat SDK state adapter, the new `ChatStateDO`, Worker injection, and Wrangler binding/migration wiring.
- 2026-03-27: Added adapter contract tests in `apps/api` and changed the package test script from a placeholder to `bun test`.
- 2026-03-27: Installed workspace dependencies, fixed the resulting TypeScript and Biome issues in the new files, and verified `@amby/api` and `@amby/channels` tests/typechecks plus repo lint.
- 2026-03-27: Validated the Worker bundle with `wrangler deploy --dry-run --outdir dist-worker` and confirmed Wrangler recognizes the new `CHAT_STATE` Durable Object binding.

## Surprises / discoveries

- The Worker path already uses Durable Objects for conversation buffering, but Chat SDK state remained memory-backed and isolated from that durable flow.
- The repo does not have a Worker/DO unit-test harness yet, so the adapter contract tests need to target a fake namespace/stub shape.
- The shared `@amby/channels` package already knows about Worker bindings, but Worker-only `cloudflare:workers` imports still need to stay in `apps/api` to avoid bleeding runtime-specific code into Bun paths.
- Local Worker smoke testing depends on generating `apps/api/.dev.vars` through `doppler run -- ./scripts/generate-dev-vars.sh`, and this workspace currently lacks a configured Doppler config/fallback file.

## Decision log

- Use a dedicated `ChatStateDO` instead of reusing `ConversationSession`.
- Keep the new state adapter Worker-only and inject it into `getOrCreateChat(...)`.
- Use a single unsharded Chat SDK state DO for now.
- Store list values as JSON arrays inside the cache table to mirror current memory-adapter semantics.

## Retrospective

- The code, tests, docs, and Worker config changes landed as planned, and the package-level verification plus Worker dry-run validation passed.
- Live webhook replay through `bun run api:dev:worker` remains blocked by missing local Doppler configuration rather than by code or Wrangler validation failures.
