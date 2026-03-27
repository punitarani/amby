# Telegram Formatting Plan

## Purpose

Make agent replies channel-aware so Telegram replies use formatting that renders correctly in Telegram clients, while keeping the generation rules explicit and maintainable for future channels.

User-visible outcome:

- Telegram replies render bold/code/links/lists correctly instead of showing raw CommonMark markers like `**bold**`.
- The agent is told what formatting subset to generate for the active channel.
- Telegram delivery uses a transport that matches Telegram Bot API formatting rules.

## Scope

- Add channel-aware output-format guidance to the conversation prompt.
- Add Telegram outbound formatting/rendering helpers.
- Route Telegram sends through the new formatter for direct replies, workflow replies, and command/status messages.
- Add regression tests and update channel docs.

## Non-goals

- Adding a new non-Telegram channel.
- Supporting every Telegram formatting feature.
- Preserving Telegram streaming if it complicates correctness.

## Architecture Impact

- `packages/agent` gains explicit channel/output-format prompt rules.
- `apps/api` gains a Telegram-specific outbound formatting boundary that converts trusted internal markdown-like output into Telegram HTML before sending.
- Telegram outbound delivery becomes an explicit adapter layer instead of depending on Chat SDK’s default Telegram markdown handling.

## Likely Files

- `packages/agent/src/specialists/prompts.ts`
- `packages/agent/src/context/builder.ts`
- `packages/agent/src/conversation/engine.ts`
- `packages/agent/src/types/agent.ts`
- `apps/api/src/telegram/index.ts`
- `apps/api/src/telegram/utils.ts`
- `apps/api/src/workflows/agent-execution.ts`
- `apps/api/src/bot.ts`
- `docs/CHANNELS.md`
- `apps/api/src/telegram/*.test.ts`

## Commands

- `bun run format`
- `bun run lint:fix`
- `bun run typecheck`
- `bun run build`

## Acceptance Checks

1. A reply containing `**bold**` is delivered to Telegram with rendered bold text, not raw asterisks.
2. Telegram list items remain readable and do not lose inline formatting.
3. Progress replies and final replies go through the same Telegram formatter boundary.
4. The agent prompt includes explicit formatting instructions for the active channel.
5. Tests cover markdown-to-Telegram rendering and long-message chunking behavior.
6. Full repo checks pass: format, lint:fix, typecheck, build.

## Discoveries

- Telegram Bot API only renders formatting when `parse_mode` or explicit entities are sent.
- Telegram legacy `Markdown` parse mode is backward-compatibility only and does not support CommonMark `**bold**`; Telegram recommends `MarkdownV2` or `HTML` for richer formatting.
- `@chat-adapter/telegram@4.23.0` sets `parse_mode` only for card/markdown payloads and hardcodes legacy `Markdown`.
- The current code usually sends plain strings via `adapter.postMessage()` / `adapter.editMessage()`, so no parse mode is sent at all.
- The workflow streaming path bypasses Chat SDK thread streaming and edits plain text directly, so even healed markdown would not render.

## Milestones

1. Add plan and channel-format prompt rules.
2. Implement Telegram formatter and outbound sender wrapper.
3. Switch Telegram call sites to the wrapper and simplify streaming if needed.
4. Add tests and docs.
5. Run verification, commit, push, and open PR.

## Progress Log

- 2026-03-26: Read repo architecture and channel docs.
- 2026-03-26: Verified Telegram Bot API formatting docs and Chat SDK Telegram adapter behavior.
- 2026-03-26: Confirmed root cause: agent emits CommonMark, current Telegram send path either omits `parse_mode` or uses legacy Markdown.
- 2026-03-26: Added shared channel-presentation metadata and prompt rules so conversation generation is channel-aware.
- 2026-03-26: Implemented Telegram markdown-to-HTML rendering and switched outbound sends to `parse_mode=HTML`.
- 2026-03-26: Removed Telegram streaming edits, kept typing indicators, and updated the mock channel to preserve/render HTML parse mode.
- 2026-03-26: Added regression tests for formatter output, prompt rules, and mock message state.
- 2026-03-26: Verified with `bun run format`, `bun run lint:fix`, `bun run typecheck`, `bun run build`, and targeted `bun test` runs.

## Decision Log

- 2026-03-26: Use channel-aware markdown generation rules in the agent prompt instead of asking the model to emit Telegram-specific syntax directly.
- 2026-03-26: Render Telegram outbound messages as HTML with `parse_mode=HTML` instead of using Chat SDK's Telegram markdown transport, because the current adapter hardcodes legacy `Markdown`.
- 2026-03-26: Disable Telegram streaming for now and keep typing indicators, because the existing post/edit streaming path would require partial markdown-to-HTML conversion and currently bypasses the formatting boundary entirely.

## Surprises

- Chat SDK Telegram adapter currently hardcodes legacy `Markdown`, which conflicts with standard markdown emitted by the agent and by Chat SDK’s own markdown AST/stringify helpers.

## Retrospective

- The durable fix was at the channel boundary, not in prompt wording alone. Once the repo had an explicit channel presentation contract and a Telegram formatter boundary, both generation and rendering became mechanically checkable.
