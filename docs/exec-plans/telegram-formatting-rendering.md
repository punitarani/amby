# Telegram Formatting And Rendering Plan

## Purpose

Make outbound Telegram text render using Telegram-supported formatting instead of sending raw markdown-like strings. User-visible outcome: bold, italic, code, links, block quotes, bullets, numbered lists, and simple tables render in Telegram in a predictable way.

## Scope

- Telegram outbound text rendering in `@amby/channels`
- Worker/runtime sender path
- Command reply path that uses `TelegramSender`
- Focused regression tests for Telegram rendering
- Channel docs update

## Non-goals

- Rewriting agent prompts
- Changing inbound Telegram parsing
- Introducing platform-specific formatting logic outside the Telegram channel boundary
- Full rich-card support in the custom sender path

## Architecture Impact

This change stays inside layer 6 (`channels`) per `docs/ARCHITECTURE.md`. The formatter is a Telegram transport-boundary concern and must not leak into agent/runtime code. The rest of the system can continue producing normal markdown-ish text; the Telegram channel owns translating that into Telegram-safe output.

## Files Likely To Change

- `packages/channels/src/telegram/sender.ts`
- `packages/channels/src/telegram/index.ts`
- `packages/channels/src/index.ts`
- `packages/channels/src/telegram/utils.test.ts`
- `packages/channels/src/telegram/*.test.ts`
- `docs/channels/telegram.md`
- `packages/channels/package.json`

## Milestones

1. Add a dedicated Telegram markdown/rendering module.
2. Wire outbound sender methods through the renderer and set the correct Telegram parse mode.
3. Add regression tests for common markdown structures and chunking.
4. Update channel docs and run targeted validation.

## Commands

- `bun test packages/channels/src/telegram/*.test.ts`
- `bun test packages/channels/src/posthog.test.ts packages/channels/src/telegram/*.test.ts`
- `bun run --filter @amby/channels typecheck`

## Acceptance Checks

- `**bold**` renders as Telegram bold text.
- `*italic*` or `_italic_` renders as Telegram italic text.
- Markdown bullets and ordered lists render as readable Telegram list lines.
- Inline code and fenced code blocks render with Telegram code formatting.
- Markdown links render as clickable Telegram links.
- Simple markdown tables render as readable ASCII tables.
- Long formatted responses still split into valid Telegram messages without broken tags.
- Existing attachment delivery behavior remains unchanged.

## Progress Log

- 2026-03-29: Traced Worker and Bun Telegram outbound paths. Confirmed raw strings are sent directly to Telegram Bot API without `parse_mode`, so markdown-like output is delivered literally.
- 2026-03-29: Reviewed `chat-sdk.dev` Telegram adapter docs and Telegram Bot API formatting docs to align with Telegram-supported rendering rather than inventing a custom dialect.
- 2026-03-29: Added `render-markdown.ts` in `packages/channels/src/telegram` to convert markdown/GFM output into Telegram HTML plus safe chunking.
- 2026-03-29: Wired `TelegramSender` and `TelegramReplySenderLive` through the new renderer so both command replies and workflow replies use the same formatting path.
- 2026-03-29: Added regression tests for inline formatting, lists, block quotes, code blocks, tables, task lists, and HTML chunk balancing.
- 2026-03-29: Ran `bun test packages/channels/src/posthog.test.ts packages/channels/src/telegram/*.test.ts` and `bun run --filter @amby/channels typecheck`.

## Surprises / Discoveries

- The repo already uses Chat SDK for inbound Telegram handling, but the durable outbound workflow bypasses Chat SDK rendering and posts raw text directly through the Bot API.
- Telegram HTML mode is a better target than MarkdownV2 here because it supports the needed entities while avoiding brittle escaping rules.

## Decision Log

- Decision: keep formatting translation inside `@amby/channels`.
  - Reason: it is a transport concern and matches the architecture boundary.
- Decision: target Telegram HTML parse mode instead of MarkdownV2.
  - Reason: simpler escaping, supports nested formatting, and matches Telegram’s supported entity set cleanly.

## Retrospective

- Keeping the conversion isolated to the channel boundary worked cleanly: no agent/runtime code had to change, and the renderer is now testable as a pure module.
