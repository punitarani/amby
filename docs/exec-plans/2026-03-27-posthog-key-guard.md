# PostHog Key Guard Plan

## Purpose

Prevent `amby-api` from throwing when PostHog is not configured, while preserving analytics when a valid PostHog key is present.

## User-visible outcome

- Telegram command handling in `amby-api` no longer crashes if `POSTHOG_KEY` is unset or whitespace-only.
- API exception capture continues to send events to PostHog when a valid key exists.

## Scope

- Harden the PostHog client wrappers used by `apps/api` and `packages/channels`.
- Add regression coverage for the missing-key path and client reuse behavior.

## Non-goals

- No PostHog event taxonomy changes.
- No Sentry environment-tagging cleanup unless the investigation shows it is required for this fix.
- No broader telemetry package extraction.

## Architecture impact

- Keep PostHog handling at the runtime/composition edge.
- Treat `POSTHOG_KEY` as boundary input that must be normalized before constructing the SDK client.
- Avoid propagating raw env assumptions deeper into Telegram command handling.

## Milestones

1. Confirm the failing stack and identify every PostHog client constructor path.
2. Normalize PostHog key handling so blank values do not instantiate the SDK.
3. Add regression tests for blank-key behavior and stable client reuse.
4. Run targeted tests and typechecks for changed packages.

## Likely files to change

- `packages/channels/src/posthog.ts`
- `packages/channels/src/posthog.test.ts`
- `apps/api/src/posthog.ts`

## Commands

- `bun test packages/channels/src/posthog.test.ts`
- `bun run --filter @amby/channels typecheck`
- `bun run --filter @amby/api typecheck`

## Acceptance checks

- Calling the PostHog wrapper with `""` or whitespace-only keys returns no client and does not throw.
- Calling the wrapper with a valid key returns a client instance.
- Repeated calls with the same normalized configuration reuse the same client.
- `packages/channels` typechecks after the wrapper return type changes.
- `apps/api` typechecks after the wrapper return type changes.

## Progress log

- 2026-03-27: Read `AGENTS.md`, `ARCHITECTURE.md`, and `docs/ARCHITECTURE.md`.
- 2026-03-27: Queried Sentry issue `AMBY-API-B` and confirmed the crash originates from Telegram command handling in `packages/channels`, not the API error handler.
- 2026-03-27: Identified duplicated PostHog wrappers in `packages/channels/src/posthog.ts` and `apps/api/src/posthog.ts`.
- 2026-03-27: Hardened both PostHog wrappers to trim the key and return `null` instead of instantiating the SDK with blank configuration.
- 2026-03-27: Updated Telegram command handling and the API error path to tolerate missing PostHog configuration.
- 2026-03-27: Added `packages/channels/src/posthog.test.ts` to cover blank-key and client-reuse behavior.
- 2026-03-27: Ran targeted verification: `bun test packages/channels/src/posthog.test.ts`, `bun run --filter @amby/channels typecheck`, `bun run --filter @amby/api typecheck`, and `bunx @biomejs/biome check ...` on the edited files.

## Surprises / discoveries

- The Sentry event is tagged `environment=production`, but the stack points at a `.wrangler/tmp/dev-*` bundle, so the issue was likely emitted from a dev-style worker build.
- `apps/api/src/worker.ts` already guards the API error-path capture with a truthy key check; the Telegram command path does not.
- `apps/api/wrangler.toml` does not require `POSTHOG_KEY`, so missing PostHog configuration is an expected runtime state.

## Decision log

- Fix the boundary once in each local wrapper rather than sprinkling ad hoc key checks through every caller.
- Return `null` for missing PostHog configuration so call sites must handle the absence explicitly.
- Add regression coverage in `packages/channels`, where the reported issue occurs.

## Retrospective

- The failure was caused by treating optional telemetry configuration as mandatory deep inside the Telegram command path. Guarding the wrapper itself keeps the boundary explicit and prevents future callers from reintroducing the same crash class.
