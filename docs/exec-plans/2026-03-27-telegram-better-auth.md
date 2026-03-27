# Telegram Better Auth First-Party Plugin

## Purpose

Build an internal Telegram Better Auth plugin in `@amby/auth` so Telegram authentication, browser sign-in flows, and bot-first identity provisioning share one canonical identity model.

## User-visible outcome

- Telegram Login Widget, Mini App auth, link/unlink, config, and Telegram OIDC are available through first-party Better Auth endpoints under `/api/auth`.
- Browser auth flows create Better Auth sessions on the API origin.
- Telegram bot onboarding continues to work, but identity creation/updating moves into an auth-owned service instead of channel-local SQL.
- Safe unlink blocks silent bot reprovisioning until the user explicitly relinks Telegram.

## Scope

- Refactor `@amby/auth` into a modular auth factory, Telegram server plugin, Telegram client plugin, shared Telegram identity parsing/verification utilities, and an auth-owned Telegram identity service.
- Extend the Drizzle auth schema with Amby-specific Telegram fields and unlink tombstones.
- Mount Better Auth routes in both API runtimes.
- Update channel/runtime callers to use the auth-owned Telegram identity service.
- Add mock/browser verification surface in `apps/mock`.
- Update docs and env references for API-origin Better Auth hosting.

## Non-goals

- No redesign of `apps/web`.
- No changes to non-Telegram auth providers beyond what is needed for Telegram OIDC composition.
- No redesign of the conversation/workflow execution model beyond identity wiring.

## Architecture impact

- `@amby/auth` becomes the single owner of Telegram auth and Telegram identity persistence.
- `@amby/channels` stops writing auth rows directly and consumes a narrow Telegram identity interface from `@amby/auth`.
- `@amby/db` remains the migration and schema source of truth; Better Auth schema additions mirror those fields for typing only.
- Better Auth is hosted on the API origin and mounted explicitly in `apps/api`.

## Milestones

1. Add execution plan and codify Telegram auth boundaries.
2. Split `@amby/auth` into factory, server plugin, client plugin, shared Telegram verification utilities, and Telegram identity service.
3. Extend DB schema/migrations/env for Telegram-specific typed fields and unlink tombstones.
4. Mount Better Auth in API runtimes and switch Telegram channel/runtime callers to the auth service.
5. Add mock verification surface, update docs, and run targeted verification.

## Likely files to change

- `packages/auth/src/index.ts`
- `packages/auth/src/*`
- `packages/auth/package.json`
- `packages/auth/README.md`
- `packages/db/src/schema/users.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/*`
- `packages/channels/src/telegram/utils.ts`
- `packages/channels/src/telegram/bot.ts`
- `packages/channels/src/telegram/chat-sdk.ts`
- `apps/api/src/index.ts`
- `apps/api/src/worker.ts`
- `apps/api/src/workflows/agent-execution.ts`
- `packages/env/src/shared.ts`
- `packages/env/src/local.ts`
- `packages/env/src/workers.ts`
- `.env.example`
- `apps/mock/app/page.tsx`
- `apps/mock/*`
- `docs/CHANNELS.md`
- `docs/DATA_MODEL.md`
- `docs/DEVELOPMENT.md`
- `apps/mock/README.md`

## Commands

- `bun run db:generate`
- `bun test packages/auth`
- `bun test packages/channels`
- `bun run --filter @amby/api typecheck`
- `bun run --filter @amby/mock typecheck`
- `bun run lint`
- `bun run api:dev`
- `bun run mock`

## Acceptance checks

- `POST /api/auth/telegram/signin` accepts valid Login Widget payloads, resolves the canonical `accounts(providerId="telegram", accountId=<telegram id>)` record, and sets Better Auth session cookies.
- `POST /api/auth/telegram/link` requires an authenticated session and links Telegram to the current user without duplicating accounts.
- `POST /api/auth/telegram/unlink` enforces safe unlink rules and records a tombstone that prevents silent reprovision from bot traffic.
- `POST /api/auth/telegram/miniapp/signin` and `POST /api/auth/telegram/miniapp/validate` verify Mini App `initData` using Web Crypto.
- Telegram OIDC callback lands in the same canonical account model (`providerId="telegram"`).
- Bot `/start` for a new Telegram user still provisions one user/account pair.
- Repeated Telegram messages update typed Telegram account/user fields without duplicating the account.
- Delivery-target resolution still finds the Telegram chat id after the schema change.
- `bun run db:generate`, targeted tests, typechecks, and lint pass.

## Progress log

- 2026-03-27: Read root `AGENTS.md`, root architecture docs, auth package, DB schema, Telegram channel callers, env config, API runtime entrypoints, and mock app structure.
- 2026-03-27: Confirmed the current Telegram identity flow still lives in `packages/channels/src/telegram/utils.ts` and Better Auth is not yet mounted on the API runtime.
- 2026-03-27: Split `@amby/auth` into `create-auth.ts`, `auth-service.ts`, `client.ts`, and `src/telegram/*` modules for server endpoints, verification, OIDC, and identity ownership.
- 2026-03-27: Added a first-party Telegram Better Auth plugin with `/telegram/config`, `/telegram/signin`, `/telegram/link`, `/telegram/unlink`, `/telegram/miniapp/signin`, and `/telegram/miniapp/validate`.
- 2026-03-27: Composed Telegram OIDC through Better Auth `genericOAuth` with provider id `telegram`, PKCE, Telegram discovery, JWKS-backed `id_token` verification, and profile mapping into the same canonical account model.
- 2026-03-27: Added typed Telegram fields to Drizzle (`users.telegramUsername`, `users.telegramPhoneNumber`, `accounts.telegramChatId`) plus `telegram_identity_blocks` for safe unlink tombstones, then generated migration `packages/db/drizzle/0012_dear_big_bertha.sql`.
- 2026-03-27: Moved Telegram identity upsert/provision logic out of `@amby/channels` and into `TelegramIdentityService`, then rewired bot/runtime callers to consume that service and handle blocked relink states explicitly.
- 2026-03-27: Mounted Better Auth at `/api/auth/*` in both `apps/api/src/index.ts` and `apps/api/src/worker.ts`, with path-scoped CORS derived from trusted auth origins.
- 2026-03-27: Added `apps/mock` browser verification support through `TelegramAuthPanel` and `/api/telegram-auth`, which signs mock Login Widget and Mini App payloads with the configured bot token.
- 2026-03-27: Updated docs and env defaults so `BETTER_AUTH_URL` points at the API origin root (`http://localhost:3001` in local development).
- 2026-03-27: Verified targeted tests, typechecks, migration generation, and lint after tightening the client typings for Better Auth fetch responses.

## Surprises / discoveries

- `@amby/auth` is currently a single-file wrapper around Better Auth, so the Telegram work requires a real package split rather than adding one endpoint file.
- Telegram delivery-target lookups currently depend on `accounts.metadata.chatId`, so the typed `telegramChatId` migration must carry those downstream readers with it.
- `BETTER_AUTH_URL` is currently defaulted to the web origin, but Better Auth’s runtime expects the API origin/root and appends `/api/auth` via `basePath`.
- Better Auth client action fetches are typed loosely enough that the new Telegram client helpers needed explicit response envelopes to satisfy downstream app typechecking.
- Telegram Mini App verification is sensitive to the exact HMAC derivation path; the second-stage HMAC must use the raw bytes from the first HMAC, not a hex string.

## Decision log

- Keep canonical Telegram linkage in `accounts.providerId = "telegram"` and `accounts.accountId = <telegram user id>` for every flow.
- Add typed Telegram fields for username/phone/chat-id instead of continuing to rely on free-form JSON metadata.
- Use a tombstone/block table to enforce safe unlink without inventing a second canonical account linkage.
- Keep `apps/web` marketing-only and use `apps/mock` for browser verification.
- Reuse Better Auth `genericOAuth` for Telegram OIDC rather than introducing a second custom callback stack.
- Keep browser explicit relink flows responsible for clearing tombstones; bot traffic remains blocked until the user explicitly relinks.
- Enforce safe unlink by requiring at least one other linked auth account before Telegram can be removed.

## Retrospective

- The package split in `@amby/auth` made the Telegram auth surface legible enough to extend without reopening a monolithic auth file.
- Moving Telegram identity ownership behind `TelegramIdentityService` removed direct auth-table writes from the channel layer and made the bot/browser flows converge on one canonical path.
- The new mock auth panel materially improved the local harness: widget, Mini App, session, unlink, and OIDC bootstrap can now be exercised without Telegram infrastructure.

## Acceptance notes

- `POST /api/auth/telegram/signin` is implemented in `packages/auth/src/telegram/plugin.ts` and creates Better Auth sessions after Login Widget verification.
- `POST /api/auth/telegram/link` requires a Better Auth session through `sessionMiddleware` and resolves conflicts through the shared Telegram identity policy.
- `POST /api/auth/telegram/unlink` records `telegram_identity_blocks` tombstones and rejects unlink when Telegram is the only auth method.
- `POST /api/auth/telegram/miniapp/signin` and `POST /api/auth/telegram/miniapp/validate` verify Mini App `initData` with Web Crypto.
- Telegram OIDC is wired through Better Auth generic OAuth and maps into `providerId="telegram"`.
- Bot provisioning still resolves one user/account pair and now updates typed Telegram fields through `TelegramIdentityService`.
- Delivery-target resolution now reads `accounts.telegramChatId` instead of `accounts.metadata.chatId`.

## Verification results

- 2026-03-27: `DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres bun run db:generate` passed and generated `packages/db/drizzle/0012_dear_big_bertha.sql`.
- 2026-03-27: `bun test packages/auth` passed with 8 tests covering widget verification, Mini App verification, unlink rules, conflict rules, and OIDC token verification.
- 2026-03-27: `bun test packages/channels` passed with 4 Telegram command parsing tests.
- 2026-03-27: `bun run --filter @amby/api typecheck` passed. The remaining output is informational TS5 `effect(unnecessaryEffectGen)` language-service messages in `apps/api/src/index.ts` and `apps/api/src/worker.ts`.
- 2026-03-27: `bun run --filter @amby/mock typecheck` passed.
- 2026-03-27: `bun run lint` passed.
