# Queue Consumer Reconciliation Plan

## Purpose / user-visible outcome

Make Cloudflare deploy failures caused by stale queue consumers obvious and actionable.

Current user-visible problem:

- `amby-api` deploys fail when Cloudflare still has a Queue consumer attached to the Worker but the current bundle no longer exports a `queue()` handler.

Desired outcome:

- operators get an explicit preflight failure before `wrangler deploy`
- the repo provides a single checked-in command to inspect and reconcile stale queue consumers

## Scope

- add a deploy helper that compares `apps/api/wrangler.toml` with live Cloudflare Queue consumers for the Worker
- add a CI preflight step that fails early with a clear remediation path
- record the confirmed production failure mode

## Non-goals

- automatically deleting queue consumers from CI
- changing runtime message flow
- restoring the removed Telegram queue handler

## Architecture impact

- no runtime architecture change
- deploy harness gains an explicit Cloudflare reconciliation check at the boundary between checked-in config and live account state

## Milestones

1. Confirm the live Cloudflare drift causing the deploy error.
2. Add a typed deploy helper that parses `wrangler.toml` and inspects live queue consumers.
3. Add CI preflight wiring.
4. Verify script behavior with focused tests.

## Exact files / modules likely to change

- `docs/exec-plans/2026-03-29-queue-consumer-reconciliation.md`
- `apps/api/src/scripts/reconcile-queue-consumers.ts`
- `apps/api/src/scripts/reconcile-queue-consumers.test.ts`
- `apps/api/package.json`
- `.github/workflows/ci-cd.yml`

## Commands to run

- `bun test apps/api/src/scripts/reconcile-queue-consumers.test.ts`
- `bun run --cwd apps/api src/scripts/reconcile-queue-consumers.ts`
- `bun run --cwd apps/api typecheck`

## Acceptance checks

- The helper reads `wrangler.toml` and reports stale queue consumers for `amby-api`.
- The helper exits non-zero in read-only mode when stale consumers exist.
- The helper can delete stale consumers when run with `--apply`.
- CI calls the helper before `wrangler deploy`.

## Progress log

- 2026-03-29: Confirmed commit `d0251b7` removed both `[[queues.consumers]]` from `apps/api/wrangler.toml` and the Worker `queue()` export.
- 2026-03-29: Confirmed via Cloudflare API that queue `telegram-inbound` still has consumer `a5f35ac10bf6483b85e2da347181ea6f` targeting script `amby-api`.
- 2026-03-29: Confirmed live worker settings still contain `TELEGRAM_QUEUE` and `TELEGRAM_DLQ` bindings because the removal deploy never completed.
- 2026-03-29: Added `reconcile-queue-consumers.ts` plus focused tests and a read-only CI preflight step before `wrangler deploy`.
- 2026-03-29: Verified helper behavior with `bun test apps/api/src/scripts/reconcile-queue-consumers.test.ts` (5 passing tests).
- 2026-03-29: `bun run --cwd apps/api typecheck` could not run in this worktree because `node_modules` is absent and `tsc` is not installed locally.
- 2026-03-29: `bunx tsc --noEmit -p apps/api/tsconfig.json` also remained blocked because the local worktree is missing `bun-types` and `@cloudflare/workers-types`.

## Surprises / discoveries

- The previous deployed worker already routed Telegram webhooks directly to the ConversationSession DO; the queue consumer appears to be stale infrastructure drift rather than an active ingress dependency.
- The failure happens during Cloudflare version upload validation, before Wrangler can reconcile the removed queue consumer from `wrangler.toml`.

## Decision log

- Chose a read-only CI preflight instead of automatic deletion to avoid mutating production infrastructure during a failed deploy.
- Chose a checked-in reconciliation script instead of an inline workflow shell fragment so the behavior is testable and reusable.

## Retrospective

- The root cause was not code correctness in the new commit; it was live Cloudflare queue-consumer drift that outlived the removed queue handler.
- A small read-only harness check is the safer default than auto-deleting consumers inside CI, because deploy-time infrastructure mutation can change production behavior before the new Worker is live.
