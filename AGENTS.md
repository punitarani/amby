# Agent-First Repository Rules

## 0. Prime directive

This repository is built for **agents that write, run, test, review, and maintain code**.

The default goal is not “write clever code.”
The goal is **make correct changes easy for an agent to discover, implement, verify, and maintain**.

When there is a tradeoff between human cleverness and agent legibility, choose agent legibility.

***

## 1. Repository source of truth

* `AGENTS.md` is the **entrypoint**, not the full manual.
* The root `AGENTS.md` must stay short and high-signal.
* Deep rules, design rationale, and stable references belong in checked-in docs, not in prompts.
* Use nested `AGENTS.md` files in subdirectories when a subsystem needs local rules.
* `ARCHITECTURE.md` must explain the stable system map, major modules, dependency directions, and invariants.
* `docs/` is the system of record for plans, product specs, reference material, architectural notes, and quality standards.

### Hard rule

Do not hide essential repo knowledge in chat history, tribal knowledge, or external links.
If the agent needs it to succeed repeatedly, check it into the repo.

***

## 2. Planning before editing

For any non-trivial feature, refactor, migration, or debugging effort:

* create an execution plan before changing code
* make the plan self-contained
* define observable acceptance criteria
* record progress, discoveries, and decisions as work proceeds

A plan is required when:

* the work spans multiple files or packages
* the change has architectural impact
* the task may take more than one session
* the implementation path is not obvious
* rollback or safety matters

### Plan requirements

Every serious plan must include:

* purpose / user-visible outcome
* scope and non-goals
* architecture impact
* milestones
* exact files/modules likely to change
* commands to run
* acceptance checks with expected behavior
* progress log
* surprises / discoveries
* decision log
* retrospective

### Hard rule

Do not start large changes with “I’ll figure it out while editing.”
That is how agent repos rot.

***

## 3. Architecture rules

* Prefer **rigid, obvious structure** over flexible mess.
* Organize code by **domain and layer**, not by vague technical buckets.
* Dependency direction must be intentional and enforced.
* Cross-cutting concerns must enter through explicit interfaces.
* Add new edges sparingly. Every new dependency edge increases agent confusion.

### Default layering rule

Prefer a shape like:

* types / schema
* adapters / parsers
* repositories / gateways
* services / domain logic
* runtime / orchestration
* interfaces / UI / API handlers

The exact names can vary. The important part is that the direction is stable and mechanically enforced.

### Forbidden

* generic `utils/` dumping grounds
* business logic in controllers, routes, or UI files
* hidden cross-package imports
* bypassing official interfaces because it is “faster”
* duplicated logic across packages when a shared invariant exists

***

## 4. Parse at the boundary

External data is hostile until proven otherwise.

* Parse and normalize data at the boundary.
* Convert raw input into typed domain objects immediately.
* Do not pass raw JSON, untyped blobs, or guessed shapes through the system.
* Make illegal states unrepresentable where reasonable.
* Use typed SDKs or local parsers instead of “YOLO” property access.

### Hard rule

Never build behavior on guessed external shapes.

If data comes from:

* APIs
* files
* user input
* env vars
* webhooks
* LLM tool output
* browser/runtime events

it must be parsed into a trusted internal representation before deeper use.

***

## 5. Optimize for agent legibility

Agents navigate code through filenames, directories, symbols, docs, tests, and tool output.

Therefore:

* prefer small, well-scoped files
* give files names that reveal intent
* prefer explicit module names over abstract helper names
* keep functions narrow and predictable
* keep public interfaces small
* make side effects obvious
* keep setup reproducible

### Good

* `billing/invoices/compute_totals.ts`
* `auth/session/validate_cookie.ts`
* `computer/runtime/start_sandbox.ts`

### Bad

* `utils.ts`
* `helpers.ts`
* `misc.ts`
* `common.ts`

### Hard rule

Filesystem structure is part of the API surface for the agent.

***

## 6. Harness over prompting

When an agent struggles, the first fix is usually **improve the harness**, not “write a smarter prompt.”

Prefer to solve failures by adding:

* better scripts
* better tests
* better local tooling
* better docs
* stricter lints
* clearer boundaries
* reproducible fixtures
* structured tool outputs
* better observability
* reusable skills

### Hard rule

Do not rely on fragile prompt magic to compensate for weak repository structure.

***

## 7. Observable systems only

The agent must be able to inspect the system it is changing.

Every meaningful subsystem should expose enough signal for an agent to debug and verify:

* tests
* logs
* metrics
* traces where useful
* health checks
* seed data / fixtures
* local startup scripts
* reproducible dev environment
* stable commands for validation

### Required standard commands

Every package or service should expose obvious commands for:

* install
* typecheck
* lint
* test
* run locally
* run targeted validation

### Hard rule

If the change cannot be validated by the agent locally, the harness is incomplete.

***

## 8. Verification is part of implementation

A code change is not complete until it has executable proof.

* Add or update tests for changed behavior.
* Run the narrowest checks during iteration.
* Run broader checks before finishing.
* Every bugfix should include a reproduction or regression test when feasible.
* Every user-visible change should have an observable acceptance path.

### Preferred verification stack

1. narrow unit tests
2. targeted integration tests
3. end-to-end or runtime validation for visible behavior
4. lint, typecheck, structural checks

### Hard rule

Do not claim a fix without running a relevant verification path.

***

## 9. Coverage expectations

* Changed code must be covered by tests.
* Uncovered changed lines are debt introduced now, not someday.
* High coverage is a harness feature, not a vanity metric.
* Prefer coverage that proves behavior, not coverage theater.

### Strong preference

Aim for complete coverage on changed logic wherever practical.
Agents perform much better when tests make every new line explain itself.

***

## 10. Small PRs, fast loops

Agent-first repos should favor:

* narrow PRs
* obvious diffs
* short feedback cycles
* fast local validation
* rapid iteration

Large all-at-once PRs multiply risk and make both human and agent review worse.

### Hard rule

Split broad work into staged, mergeable slices unless atomicity is required.

***

## 11. Mechanical enforcement beats policy prose

If a rule matters, encode it.

Prefer:

* linters
* structural tests
* import boundary checks
* schema validation
* codegen
* typed wrappers
* CI gates
* repo scripts
* pre-merge checks

over:

* long text reminders
* tribal conventions
* “please remember” documentation

### Hard rule

Human taste should be captured once, then enforced automatically.

***

## 12. Docs structure

Minimum recommended checked-in docs:

* `AGENTS.md` — root map and working rules
* `ARCHITECTURE.md` — stable codemap and invariants
* `docs/exec-plans/` — living plans for serious work
* `docs/product/` — user-facing behavior and specs
* `docs/references/` — external systems, APIs, schemas, conventions
* `docs/quality/` — quality bars, testing policy, known debt, cleanup rules

### Documentation style

* short
* direct
* stable
* actionable
* example-driven
* easy to verify

Do not write essay-docs that drift immediately.

***

## 13. Skills and reusable workflows

If a workflow repeats, package it.

Use skills for:

* common debugging flows
* browser checks
* release tasks
* repo-specific build/test flows
* migration rituals
* codegen / formatting / schema refresh routines

A skill should contain:

* when to use it
* exact commands or steps
* inputs
* outputs
* failure modes
* examples

### Hard rule

Do not make the agent rediscover the same 8-step workflow every run.

***

## 14. Thread, state, and event discipline

For harness-based systems:

* persist thread/work history explicitly
* represent work as structured events, not only final text
* make long-running work resumable
* stream progress incrementally
* separate approvals from execution
* keep state transitions explicit

### Hard rule

Do not build opaque background processes that only emit a final success/failure blob.

***

## 15. Security and secret handling

* Never hardcode secrets.
* Never paste secrets into prompts, plans, or logs.
* Use scoped secret injection.
* Restrict network access by policy where possible.
* Make destructive actions explicit and approval-gated.
* Prefer allowlists over broad outbound access.

### Hard rule

The model should never need raw secret values in visible context.

***

## 16. Environment variable checklist

When adding a new environment variable, update **all** of these files:

1. `packages/env/src/shared.ts` — add to the `Env` interface (source of truth)
2. `packages/env/src/local.ts` — add to `EnvConfig` (with `Config.redacted()` for secrets) and the `EnvServiceLive` return object
3. `packages/env/src/workers.ts` — add to `WorkerBindings` interface and `makeEnvServiceFromBindings` mapping
4. `scripts/worker-env-keys.txt` — add the key name (used by `generate-dev-vars.sh` to create `apps/api/.dev.vars`)
5. `.env.example` — add with a sensible default or empty value
6. `apps/api/wrangler.toml` — add to `[secrets].required` (for secrets) or `[vars]` (for non-secret config with defaults)

### Rules

* Secrets use `Config.redacted()` in local.ts and go in `[secrets].required` in wrangler.toml.
* Non-secret config with production defaults goes in `[vars]` in wrangler.toml.
* All env vars must have defaults in local/workers so the app starts without every var set.
* Worker-only vars (Cloudflare bindings like `HYPERDRIVE`, `BROWSER`, `AI`, DOs, queues, workflows) go in `WorkerBindings` only — not in the `Env` interface or `worker-env-keys.txt`.

### Hard rule

Every `Env` interface field must appear in local.ts, workers.ts, worker-env-keys.txt, and .env.example.
Missing any of these causes silent failures in development or deployment.

***

## 17. Garbage collection is a first-class workflow

Agent repos accumulate bad patterns quickly unless cleanup is continuous.

Run recurring cleanup work for:

* duplicated helpers
* dead code
* import violations
* stale docs
* outdated plans
* missing tests
* boundary leaks
* naming drift
* oversized files

### Hard rule

Do not wait for a giant refactor week.
Pay codebase debt continuously in small PRs.

***

## 18. What agents must not do

Agents must not:

* invent APIs or data shapes
* skip parsing at boundaries
* create generic helpers without reuse proof
* bypass package boundaries
* leave TODOs instead of finishing agreed scope
* modify unrelated code without documenting why
* claim checks passed when they were not run
* rely on hidden manual steps
* write giant instruction files that try to explain the entire repo at once

***

## 19. Default implementation workflow

1. Read root `AGENTS.md`, nearest local `AGENTS.md`, and `ARCHITECTURE.md`.
2. Read existing code before proposing new abstractions.
3. For non-trivial work, create or update an execution plan.
4. Identify the exact domain and allowed dependency direction.
5. Parse external data at boundaries.
6. Implement the narrowest change that can prove the behavior.
7. Add or update tests immediately.
8. Run targeted checks.
9. Update docs, plans, and decision log.
10. Run broader verification before finishing.
11. Open a small, legible diff.
12. If you had to work around the harness, improve the harness next.

***

## 20. Quality bar for completion

A task is done only when all of the following are true:

* behavior works
* the change respects architecture
* boundaries remain clean
* tests prove the changed behavior
* docs and plans reflect reality
* no guessed schemas remain
* no unnecessary complexity was introduced
* another agent could pick up the repo and continue without chat history

***

## 21. Style of thought

Be conservative with interfaces and aggressive with clarity.

Prefer:

* obviousness over cleverness
* structure over flexibility
* typed boundaries over runtime guessing
* smaller files over giant files
* reusable workflows over repeated improvisation
* mechanical checks over policy text
* checked-in knowledge over ephemeral chat context
