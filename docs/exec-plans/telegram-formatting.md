# Telegram Formatting Fix Plan

## Purpose / user-visible outcome

Make Amby generate Telegram-compatible rich text and deliver it through the existing Chat SDK integration so emphasis, links, code, and lists render correctly in Telegram instead of appearing as literal Markdown markers.

## Scope

- Add channel-aware response-format guidance to the conversation prompt so Telegram turns use Telegram-safe formatting rules.
- Keep `@chat-adapter/telegram` in place for the Telegram channel.
- Add a Telegram-specific outbound rendering path that preserves Chat SDK usage while sending Telegram HTML parse mode for agent-authored messages.
- Make long Telegram responses split safely without breaking HTML tags.
- Revisit Telegram streaming behavior and disable it if required for correctness.
- Add regression tests for prompt generation and Telegram formatting helpers.
- Update channel docs to reflect the new outbound behavior.

## Non-goals

- Replace Chat SDK.
- Redesign other channels.
- Add Telegram card support beyond what the upstream adapter already provides.
- Introduce a generic formatting DSL for every future channel.

## Architecture impact

- `packages/agent` gains explicit response-channel prompt behavior. This keeps channel-specific output rules at the prompt boundary instead of scattering them across callers.
- `apps/api/src/telegram` gains the Telegram-specific outbound rendering layer. Transport-specific parse mode, HTML escaping, and message splitting stay in the Telegram transport boundary.
- Telegram streaming may be disabled for agent responses because parse-mode HTML requires complete tags on every edit.

## Milestones

1. Capture prompt-level channel formatting requirements.
2. Patch Telegram outbound delivery while retaining Chat SDK.
3. Add HTML-safe splitting and document the streaming decision.
4. Add regression tests.
5. Run formatting, linting, typechecking, build, and publish the branch/PR.

## Exact files / modules likely to change

- `packages/agent/src/context/builder.ts`
- `packages/agent/src/context/builder.test.ts`
- `packages/agent/src/specialists/prompts.ts`
- `apps/api/src/bot.ts`
- `apps/api/src/telegram/index.ts`
- `apps/api/src/telegram/chat-sdk.ts`
- `apps/api/src/workflows/agent-execution.ts`
- `apps/api/src/telegram/utils.ts`
- `apps/api/src/telegram/` (new transport-specific formatting module(s))
- `docs/CHANNELS.md`

## Commands to run

- `bun test packages/agent/src/context/builder.test.ts apps/api/src/telegram/*.test.ts`
- `bun run format`
- `bun run lint:fix`
- `bun run typecheck`
- `bun run build`
- `gh auth status`
- `git status -sb`
- `git add -A`
- `git commit -m "fix telegram formatting"`
- `git push -u origin <branch>`
- `GH_PROMPT_DISABLED=1 GIT_TERMINAL_PROMPT=0 gh pr create --draft --fill --head <branch>`

## Acceptance checks

- Agent system prompt includes Telegram-specific response formatting rules when the request source is Telegram.
- Telegram agent responses render bold/code/links in Telegram using Chat SDK transport instead of showing literal Markdown punctuation.
- Telegram list output uses readable bullets/numbering without literal Markdown list syntax artifacts.
- Long Telegram HTML responses are split into valid chunks without broken tags.
- Telegram agent delivery does not rely on invalid intermediate HTML edits.
- Repo checks succeed: format, lint:fix, typecheck, and build.

## Progress log

- 2026-03-26: Read root `AGENTS.md`, `ARCHITECTURE.md`, `docs/ARCHITECTURE.md`, and `docs/CHANNELS.md`.
- 2026-03-26: Inspected `packages/agent` prompt assembly and `apps/api` Telegram runtime paths.
- 2026-03-26: Verified upstream `@chat-adapter/telegram@4.20.2` behavior from the installed package cache and confirmed that normal messages are stringified to plain Markdown text and only cards set `parse_mode`.
- 2026-03-26: Verified Telegram Bot API formatting requirements from the official Bot API docs.
- 2026-03-26: Added Telegram-aware prompt rules in `packages/agent` and plumbed response-channel detection from request metadata.
- 2026-03-26: Added a Telegram HTML formatting module and local Chat SDK adapter wrapper that preserves Chat SDK usage while sending agent-authored `raw` / markdown / AST messages with `parse_mode=HTML`.
- 2026-03-26: Replaced Telegram agent-response streaming with typing + final send so partial HTML never needs to be edited in place.
- 2026-03-26: Added regression tests for Telegram prompt rules and HTML formatting/splitting.
- 2026-03-26: Ran `bun run format`, `bun run lint:fix`, `bun run typecheck`, `bun run build`, and targeted `bun test` for the new coverage.

## Surprises / discoveries

- The workflow path does not pass Telegram metadata for single-message turns today, so prompt behavior cannot reliably infer the channel from workflow executions.
- Upstream Chat SDK Telegram streaming is documented as post+edit fallback, but Amby’s workflow currently performs its own manual post+edit loop outside Chat SDK.
- Existing `splitTelegramMessage` is plain-text only and is unsafe for HTML parse mode because it can split inside tags.

## Decision log

- 2026-03-26: Use Telegram HTML instead of MarkdownV2 for agent-authored output. HTML is easier to generate reliably, simpler to split safely, and less escape-heavy for the model than MarkdownV2.
- 2026-03-26: Treat Chat SDK `PostableRaw` as the explicit Telegram rich-text boundary in the local adapter wrapper. Plain strings keep the upstream plain-text behavior; agent-authored Telegram responses opt into HTML deliberately.
- 2026-03-26: Disable Telegram response streaming in the workflow path. Valid Telegram HTML requires complete tags, so partial post/edit streaming is correctness-hostile.
- 2026-03-26: Keep static command / system messages as plain text, escaped when sent through the HTML path.

## Retrospective

- The bug came from a mismatch between generation and transport: the agent emitted generic Markdown, while the upstream Telegram adapter intentionally sent most text as plain text.
- The durable fix required both halves: channel-aware generation rules and a transport-specific rendering boundary.
- Keeping the Telegram formatting code inside `apps/api/src/telegram/` follows the repo boundary rule: transport semantics stay at the transport edge instead of leaking into the agent core.
