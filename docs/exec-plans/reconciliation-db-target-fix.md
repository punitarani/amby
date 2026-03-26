# Reconciliation DB Target Fix

## Purpose

Stop the production reconciliation cron from failing when the worker can connect to a database
whose schema is incompatible with the current code. Keep Hyperdrive as the intended production
path, but make the connection mode explicit, validate the task schema through the same runtime path
the cron uses, and fail deploy verification when the live worker DB health is not OK.

## Scope

- Add explicit worker DB connection mode selection.
- Add reconciliation DB preflight and health classification.
- Expose a public-safe `/health/db` route in worker and local API entrypoints.
- Add deploy verification for `/health/db`.
- Add targeted tests for the new DB mode and health behavior.

## Non-goals

- Change production to permanently bypass Hyperdrive.
- Add new schema migrations.
- Change reconciliation task semantics beyond preflight validation and observability.

## Acceptance Criteria

- Worker DB source selection is explicit and test-covered.
- `DB_CONNECTION_MODE=hyperdrive` fails fast if Hyperdrive is missing.
- Scheduled reconciliation runs a preflight before the cron body and preserves the original cause on failure.
- `/health/db` returns:
  - `200` with `{ status: "ok", database: { mode } }` on success.
  - `503` with `{ status: "error", database: { mode, code } }` on failure.
- Deploy workflow fails if the production worker `/health/db` route does not return `200`.
- Targeted tests pass and typecheck remains green.

## Files Likely To Change

- `packages/env/src/shared.ts`
- `packages/env/src/local.ts`
- `packages/env/src/workers.ts`
- `apps/api/src/queue/runtime.ts`
- `apps/api/src/handlers/reconciliation.ts`
- `apps/api/src/worker.ts`
- `apps/api/src/index.ts`
- `apps/api/src/sentry.ts`
- `packages/computer/src/harness/reconciliation.ts`
- `.github/workflows/ci-cd.yml`
- `apps/api/wrangler.toml`

## Commands

- `bun test packages/env/src/workers.test.ts`
- `bun test packages/computer/src/harness/reconciliation.test.ts`
- `bun test apps/api/src/health.test.ts`
- `bun run --filter @amby/api test`
- `bun run --filter @amby/computer test`
- `bun run --filter @amby/env typecheck`
- `bun run typecheck`

## Progress Log

- 2026-03-26: Investigated Sentry issues `AMBY-API-8` and `AMBY-API-A`; confirmed same SQL failure across releases.
- 2026-03-26: Verified the cron query depends on `tasks.runtime`, added in migration `0009`.
- 2026-03-26: Verified deploys already run DB migrations, so the likely fault is worker DB target drift or schema incompatibility on the DB actually used by the worker.
- 2026-03-26: Began implementation.
- 2026-03-26: Added explicit worker DB mode selection, shared worker DB resolution, reconciliation DB preflight reuse, `/health/db` routes, deploy verification, and targeted tests.
- 2026-03-26: Verified `@amby/env`, `@amby/computer`, and `@amby/api` tests; verified package and repo typecheck.

## Discoveries

- Worker runtime currently prefers `HYPERDRIVE.connectionString` over `DATABASE_URL` implicitly.
- The local API entrypoint always uses direct `DATABASE_URL`.
- The cron failure is currently detected only after the scheduled handler starts running.

## Decisions

- Keep Hyperdrive as the production target.
- Make DB selection explicit via `DB_CONNECTION_MODE`.
- Put the worker DB resolver in `@amby/env`.
- Put the reconciliation DB preflight in `@amby/computer`.

## Retrospective

- The root cause is now easier to diagnose in code and in deploy verification, but production still needs the operational Hyperdrive/database parity check from the rollout notes before this can be considered fully resolved in the live environment.
