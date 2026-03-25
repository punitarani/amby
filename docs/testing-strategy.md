# Testing Strategy

## Philosophy

Every test must justify its existence by covering meaningful branching, invariants, or flow correctness. No vanity coverage.

Tests cover **decision logic and architectural boundaries**:
- Thread routing heuristics
- Execution planning precedence
- Task state machine invariants
- Lock conflict resolution
- Plugin registry wiring
- Tool resolution filtering
- Context assembly

## Stack

- **Runner**: `bun:test` (built-in, zero config)
- **Assertions**: `expect` from `bun:test`
- **Mocking**: Hand-crafted doubles matching existing patterns — no mock library
- **DB**: Not needed for current wave (pure logic + Effect stubs)

## Layers

1. **Unit tests** — pure functions, state machines, decision heuristics
2. **Wiring tests** — plugin registration, tool resolution, context assembly
3. **Integration tests** — (future) DB-backed flows, LLM stubs
4. **E2E tests** — (future) Telegram webhook → full runtime

## Mocking Strategy

- **Effect services**: Stub `QueryFn` with `Effect.succeed(…)` returning hardcoded data
- **Plugin services**: Implement service interface with minimal stubs (e.g., `getProfile: () => Effect.succeed(…)`)
- **No real DB**: Tests run against pure logic; DB interactions are stubbed at the query boundary
- **No real LLM**: Model-based routing tested separately; heuristic logic tested directly

## Test Helpers

Shared factories in `packages/agent/src/test-helpers/`:
- `makeTask()` — builds `ExecutionTask` with sensible defaults
- `makeResult()` — builds `ExecutionTaskResult` with sensible defaults
- `makeAgentRunConfig()` — builds `AgentRunConfig` with full defaults

## Running Tests

```bash
# All tests across monorepo
bun run test

# Single package
cd packages/agent && bun test

# Single file
bun test packages/agent/src/router.test.ts
```

## What Is NOT Tested (Intentionally)

- Schema definitions (declarative, no logic)
- Migration SQL (tested by deployment)
- Cloudflare Worker runtime wiring (platform glue)
- `ai` SDK internals (third-party)
- Trivial barrel exports
- Environment config accessors
- Auth package (BetterAuth wrapper, no custom logic)
- DB service layer composition (boilerplate)

## Adding Tests

1. Colocate test files with source: `module.test.ts` next to `module.ts`
2. Use `describe` blocks matching the exported function name
3. Test boundary conditions, not happy paths only
4. Use `it.each()` for parametric tests (state machines, matrices)
5. Import from `test-helpers/` for shared factories
