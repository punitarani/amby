Here is the migration spec I would actually use.

Your package instinct is mostly right. The best target is:

* `auth`
* `env`
* `db`
* `core`
* `agent`
* `browser`
* `computer`
* `plugins`
* `skills`
* `channels`

That is the smallest package set that still gives you hard boundaries. Anything more granular turns into package soup. Anything flatter recreates the current god-object problem.

The current repo already proves the main issue: `@amby/agent` is still the center of too much logic, while `@amby/computer` and `@amby/connectors` also own mixed concerns like auth state, callbacks, persistence, monitoring, and tool exposure. The entrypoints duplicate composition as well.

## What changes and what does not

These are hard decisions:

* Full backend rewrite: **yes**
* Web app rewrite: **no**
* CLI as a channel: **remove**
* Telegram as the only channel: **yes**
* Keep Effect: **yes**, but use it surgically, not everywhere
* Keep Bun/Turbo/Drizzle/Postgres/Hono/AI SDK/Daytona/Stagehand/Better Auth: **yes**
* Keep current behavioral surface where possible: **yes**
* Preserve old package graph: **no**

The current repo is a Bun/Turbo monorepo with `apps/api`, `apps/web`, `apps/cli`, and packages like `agent`, `auth`, `browser`, `channels`, `computer`, `connectors`, `db`, `env`, and `memory`. The rewrite should collapse `connectors`, `memory`, and job logic into built-in plugins, while preserving `browser` and `computer` as provider-facing runtime packages.

## The three options, and the one to pick

### Option A: refactor the current package graph in place

Reject it.

You would spend months moving code between `agent`, `computer`, `connectors`, `memory`, and `channels`, and still keep the same mental model: conversation loop as god object, plus side systems hanging off it.

### Option B: explode everything into many micro-packages

Reject it.

That gives theoretical cleanliness and practical misery. It increases boilerplate, composition overhead, and dependency management. It also violates your “fewest LOC” goal.

### Option C: keep ~10 packages, but make each one real

Pick this.

This gives the smallest stable architecture:

* `core` is the domain kernel
* `agent` is orchestration/runtime
* `db` is persistence
* `plugins` contains built-in product capabilities
* `skills` contains Agent Skills support
* `browser` and `computer` are external runtime providers
* `channels` is Telegram-only delivery/input
* `auth` stays isolated
* `env` stays tiny

That is the best balance of simplicity, modularity, and future-proofing.

## Architectural rule set

These are non-negotiable.

### Rule 1: `core` owns the language of the system

`core` defines:

* entities
* commands
* events
* repository interfaces
* provider interfaces
* plugin contracts
* orchestration contracts
* shared error model

`core` does **not** import:

* Drizzle
* Daytona
* Stagehand
* Better Auth
* Composio
* Telegram SDKs
* AI SDK provider SDKs

### Rule 2: `agent` owns workflows, not providers

`agent` owns:

* turn handling
* routing
* context loading
* planning
* orchestration
* specialist execution graph
* streaming
* run lifecycle

`agent` does **not** import raw provider SDKs. It talks only to `core` ports plus the plugin registry.

### Rule 3: `plugins` own product capabilities

`plugins` contains built-in capabilities:

* memory
* automations
* integrations
* browser plugin
* computer plugin

These are product-level features. They are not infra packages.

### Rule 4: `skills` are not plugins

This is critical.

Agent Skills are an open folder-based format centered on a required `SKILL.md`, with optional scripts/resources, and the model is progressive disclosure: discover by name/description first, load full instructions only when activated. `skills.sh` is the installation/discovery ecosystem around that format. ([Skills][1])

So:

* **plugins** = executable code capabilities inside Amby
* **skills** = discoverable instruction/workflow bundles that the agent can load on demand

Do not merge them conceptually.

### Rule 5: `channels` only does transport

With CLI gone, `channels` becomes Telegram-only for now. The current `channels` package still carries a generic registry and a `ChannelType` of `"cli" | "telegram"`, which is unnecessary complexity now.

### Rule 6: only app roots build Layers

You want Effect, but not Layer spaghetti.

Use `Context.Tag` and `Layer` at package boundaries and app roots. Keep pure logic plain. The Effect team explicitly positions the library as incrementally adoptable and usable across Bun and Cloudflare-style environments, which fits your stack. ([Effect][2])

## Final package map

```text
packages/
  auth/
  env/
  db/
  core/
  agent/
  browser/
  computer/
  plugins/
  skills/
  channels/

apps/
  api/
  web/      # unchanged / out of scope
```

## Exact package responsibilities

### `@amby/env`

Purpose: typed environment access only.

Contains:

* env schemas
* local/worker env adapters
* no business logic

Keep this package. It is small and useful. The current repo already isolates env access.

### `@amby/auth`

Purpose: app/user authentication only.

Contains:

* Better Auth setup
* session/api key auth for app surfaces
* no agent runtime logic
* no integration auth
* no Codex auth

The current auth package is already close to this shape and should stay isolated.

### `@amby/db`

Purpose: schema, repositories, migrations, query implementations.

Contains:

* Drizzle schema
* migration files
* repository implementations for `core` ports
* transactional helpers
* no runtime/provider logic

Current `db` is directionally correct, but the schema needs a greenfield rewrite. It currently mixes conversations, traces, tasks, task events, memories, connector auth requests, connector preferences, jobs, sandboxes, and user volumes.

### `@amby/core`

Purpose: domain kernel.

Contains:

* `Conversation`, `Thread`, `Message`, `Run`, `Task`, `Memory`, `Automation`, `IntegrationAccount`, `ComputeInstance`
* domain commands/events
* repository interfaces
* provider interfaces
* plugin interfaces
* shared policies and invariants

Contains Effect interfaces and typed errors, but not provider SDK code.

### `@amby/agent`

Purpose: orchestrator/runtime.

Contains:

* `ConversationEngine`
* `ThreadRouter`
* `ContextLoader`
* `RunRecorder`
* `Planner`
* `ExecutionGraph`
* `TurnStreamer`
* specialist runtime
* task scheduler coordination

The rewrite center moves here. The current `AgentService` is too large and must be broken apart. Right now it resolves threads, builds context, constructs tools, runs the conversation loop, persists messages, links traces, and handles execution state.

### `@amby/browser`

Purpose: short-lived browser execution provider.

Contains:

* browser task input/output model
* Stagehand/playwright provider implementations
* browser session lifecycle
* extraction/action execution
* no domain persistence

Keep browser separate. The current package already has a good shared browser task model.

### `@amby/computer`

Purpose: durable computer/runtime execution provider.

Contains:

* Daytona sandbox adapter
* Codex harness integration
* compute lifecycle
* callback verification
* task monitor
* artifact collection
* auth state for computer-specific providers
* no conversation routing
* no plugin exposure logic

Keep this package separate. The current repo already distinguishes browser from sandbox/computer work, and the latest code is clearly moving toward volume + snapshot-based compute.

### `@amby/plugins`

Purpose: built-in capabilities.

Contains submodules:

* `memory`
* `automations`
* `integrations`
* `browser-tools`
* `computer-tools`

This replaces:

* `@amby/memory`
* most of `@amby/connectors`
* job tools in `agent/tools/messaging`
* the old “tool groups” mental model as the primary boundary

The current repo has memory, jobs, connectors, and settings logic split awkwardly across packages and `agent/tools`. Those become first-class built-in plugins instead.

### `@amby/skills`

Purpose: support for Agent Skills.

Contains:

* skill manifest loader
* local skill discovery
* registry/source abstraction
* activation policy
* prompt bridge
* capability requirement mapping
* optional remote installer later

Important: in v1, this package should support local filesystem skills first. Remote install from `skills.sh` is **not** required for the migration cutover.

### `@amby/channels`

Purpose: Telegram transport only.

Contains:

* Telegram inbound adapter
* Telegram outbound sender
* message serialization
* typing/progress messaging
* reply target resolution
* inbound webhook/polling glue

Delete:

* CLI channel
* generic channel registry
* channel abstractions that only existed to support CLI

The current API bot and Telegram wiring should move here. Today they live in `apps/api` and thin bot utilities.

## Dependency graph

This is the exact allowed graph.

```text
env -> nothing

core -> env? no
db -> core + env
auth -> db + env

browser -> core + env
computer -> core + env

plugins -> core + browser + computer
skills -> core + env

agent -> core + plugins + skills
channels -> core + agent

apps/api -> auth + db + env + browser + computer + plugins + skills + agent + channels
apps/web -> auth + env   # backend rewrite out of scope
```

Forbidden imports:

* `agent` -> `db/schema` directly
* `agent` -> Daytona / Stagehand / Composio / Better Auth directly
* `plugins` -> `db/schema` directly
* `channels` -> `db/schema` directly
* `computer` -> `agent`
* `browser` -> `agent`
* `skills` -> provider SDKs

## Runtime model

## 1. Turn model

A **turn** is one inbound Telegram message batch handled by the orchestrator.

A turn always creates exactly one `run`.

A run may:

* answer directly
* use tools
* spawn zero or more tasks
* resume/report existing tasks
* activate zero or more skills

## 2. Run model

A **run** is the first-class execution record for a turn.

This is the biggest architectural correction.

Today the repo persists user-visible messages separately from `traces`/`trace_events`, and next-turn context is still composed mainly from message history + summaries + memory. That is not strong enough as the long-term continuity model.

In the rewrite:

* messages store user-visible chat
* runs store execution summary/state
* run events store internal trajectory
* tasks store durable subordinate work
* task events store durable task lifecycle

## 3. Task model

A **task** is durable work outside the immediate turn loop.

Tasks are only for:

* sandbox/computer work
* long-running browser work if you ever add it
* deferred automations
* future provider-backed jobs

A task always belongs to one run.
A run may own many tasks.

## Telegram-only runtime flow

```text
Telegram Update
  -> channels.telegram.decodeUpdate
  -> channels.telegram.identifyUserAndConversation
  -> agent.ConversationEngine.handleTurn
      -> core.ThreadRouter.resolve
      -> agent.ContextLoader.load
      -> skills.SkillResolver.matchAndActivate
      -> agent.Orchestrator.run
          -> plugin tools / plugin planners
          -> browser/computer via ports when needed
          -> db.RunRecorder.persist
      -> channels.telegram.sendResult
```

## Planning and orchestration model

Use AI SDK `ToolLoopAgent` only where it actually helps.

The AI SDK docs are clear on the split:

* `ToolLoopAgent` is the recommended loop abstraction for reusable tool-using agents
* explicit structured workflows are the right choice when you need predictable control flow and repeatable orchestration. ([AI SDK][3])

So the rule is:

* outer workflow: explicit code in `agent`
* inner loop: `ToolLoopAgent` for orchestrator and selected specialists

That means:

### explicit in code

* thread routing
* context pack construction
* run lifecycle
* planner invocation
* execution graph
* task spawning
* task reconciliation
* message persistence
* notification routing

### agent loop allowed

* conversation orchestrator
* research specialist
* integration specialist
* memory specialist
* validator specialist

### agent loop not allowed as system backbone

* task monitoring
* run state machine
* channel dispatch
* skill activation
* compute lifecycle

## Plugin model

This is the exact plugin contract I would use.

```ts
export interface AmbyPlugin {
  readonly id: string
  register(registry: PluginRegistry): void
}

export interface PluginRegistry {
  addContextContributor(contributor: ContextContributor): void
  addToolProvider(provider: ToolProvider): void
  addPlannerHintProvider(provider: PlannerHintProvider): void
  addTaskRunner(runner: TaskRunner): void
  addEventHandler(handler: EventHandler): void
}
```

That is enough. Do not build a giant plugin SDK.

### Built-in plugins

#### `memory`

Responsibilities:

* searchable memory store
* memory save/update/deactivate
* profile contribution to context
* memory write policy

Current `@amby/memory` becomes this plugin.

#### `automations`

Responsibilities:

* reminders
* recurring checks
* scheduled follow-ups
* future event-triggered work

This absorbs current `jobs` and the scheduling tool logic currently parked under messaging/settings.

#### `integrations`

Responsibilities:

* list/connect/disconnect/set preferred
* expose connected-app tools
* verify provider webhooks
* account selection rules

This absorbs current `@amby/connectors`, but split cleanly into domain-facing integration account logic and tool exposure logic. The current service mixes persistence, auth-link lifecycle, Composio session creation, and tool exposure.

#### `browser-tools`

Responsibilities:

* expose browser capability to orchestrator
* route requests to `@amby/browser`
* normalize browser artifacts/results

#### `computer-tools`

Responsibilities:

* expose durable sandbox/computer capability
* route requests to `@amby/computer`
* spawn and query tasks
* normalize artifacts/results

## Skills model

The `skills` package should support the Agent Skills format directly.

### v1 design

* local skills only
* filesystem discovery under `skills/`
* startup index reads only metadata
* activation loads full `SKILL.md`
* optional bundled resources/scripts become references only unless a plugin explicitly mediates execution

### exact rule

A skill never executes arbitrary code by itself.
A skill may only:

* contribute instructions
* contribute templates/references
* declare required capabilities
* request named tools that are already registered by plugins

### skill manifest bridge

At activation time, `skills` produces:

```ts
type ActivatedSkill = {
  id: string
  title: string
  instructions: string
  references: SkillReference[]
  requiredCapabilities: string[]
}
```

The orchestrator can then inject:

* skill instructions into system/context
* reference files into prompt context
* capability gating into planner/tool visibility

### remote install

Support later through `skills.sh`, not in migration-critical path. `skills.sh` is useful for discovery/install, but it should not block the repo rewrite. ([Skills][1])

## Browser vs computer

Keep both. Do not merge them.

### `browser`

Use for:

* short-lived read-heavy browsing
* extraction
* lightweight page actions
* no durable local environment

The current browser package already models this cleanly.

### `computer`

Use for:

* durable sandbox execution
* filesystem changes
* Codex runs
* long-running background tasks
* mounted storage
* task callbacks/artifacts/recovery

The repo is already moving toward one volume per user and main sandbox semantics, and Daytona’s current docs fit that direction: volumes are shareable across sandboxes, and snapshots are the right immutable environment primitive. Daytona also recommends explicit snapshot image tags rather than `latest`.    ([Daytona][4])

That means the compute rewrite should standardize on:

* one durable volume per user
* one main compute instance per user
* versioned immutable snapshot names
* health-driven instance replacement
* task artifacts rooted on mounted storage

## Database rewrite

Greenfield schema. No backward-compat contortions.

## Keep

### `users`, `accounts`, `sessions`

Keep under `auth`.

### `conversations`

Simplify.
Current schema includes `workspaceKey` and broad platform unions. With only Telegram, remove `workspaceKey` entirely and keep a simple uniqueness rule:

* `(user_id, channel, external_conversation_id)`

Current schema still carries extra platform breadth you do not need right now.

### `threads`

Keep, but rename `conversation_threads` to `threads`.

Fields:

* `id`
* `conversation_id`
* `source`
* `external_thread_key?`
* `label?`
* `synopsis?`
* `keywords[]?`
* `is_default`
* `status`
* `last_active_at`
* `created_at`

### `messages`

Keep user-visible only.

Fields:

* `id`
* `conversation_id`
* `thread_id`
* `run_id`
* `role`
* `content_text`
* `parts_json?`
* `metadata?`
* `created_at`

No internal tool calls here.

### `runs`

New table.

Fields:

* `id`
* `conversation_id`
* `thread_id`
* `trigger_message_id?`
* `status`
* `mode`
* `model_id`
* `planner_version`
* `summary`
* `request_json`
* `response_json`
* `started_at`
* `completed_at`

### `run_events`

New table.

Append-only.
Kinds:

* `context_built`
* `router_decision`
* `skill_activated`
* `planner_output`
* `tool_call`
* `tool_result`
* `task_spawned`
* `task_observed`
* `model_request`
* `model_response`
* `error`
* `completed`

This replaces `traces` and `trace_events` as the main first-class continuity model. The current trace system is useful, but it is too OTel-shaped and not centered enough on Amby turn semantics.

### `tasks`

Keep, but tighten the meaning.

Fields:

* `id`
* `run_id`
* `user_id`
* `thread_id`
* `plugin_id`
* `runner_kind`
* `provider`
* `status`
* `input_json`
* `output_json`
* `artifacts_json`
* `runtime_json`
* `summary`
* `error`
* `started_at`
* `heartbeat_at`
* `completed_at`
* `created_at`
* `updated_at`

Drop unrelated mixed concerns from the core table where possible.

### `task_events`

Keep append-only.

### `memories`

Keep with light cleanup.

### `automations`

Replace `jobs`.

Fields:

* `id`
* `user_id`
* `kind`
* `status`
* `schedule_json`
* `next_run_at`
* `last_run_at`
* `payload_json`
* `delivery_target_json`
* `created_at`
* `updated_at`

No `channel_type` enum. Delivery target should be generic JSON. Current `jobs` hardcodes `"cli" | "telegram"` and that should die with CLI.

### `integration_accounts`

Replace `connector_preferences` and the auth-request indirection.

Fields:

* `id`
* `user_id`
* `provider`
* `external_account_id`
* `status`
* `is_preferred`
* `metadata_json`
* `created_at`
* `updated_at`

For temporary auth flows, use signed state tokens, not a dedicated `connector_auth_requests` table unless a provider truly forces durable server-side state. The current auth-request table mostly exists to map a UUID to a redirect URL. That is unnecessary state.

### `compute_volumes`

Replace `user_volumes` with same semantics.

### `compute_instances`

Replace `sandboxes`.

## Effect usage policy

You said you want Effect where appropriate. Here is the exact rule.

### Use Effect for

* service interfaces
* dependency injection at package/app boundaries
* long-lived runtime orchestration
* queues/pubsub/streams
* retries/timeouts/resource cleanup
* monitors/pollers/task supervisors
* startup/shutdown lifecycle
* typed error channels across package boundaries

### Do not use Effect for

* plain entities
* DTOs
* zod schemas
* data mappers
* string builders
* tiny pure helpers
* simple synchronous value transformations

### Use `Context.Tag` for

* repository services
* provider ports
* plugin registry
* channel sender
* model service
* runtime services

### Do not create a Tag for

* every helper module
* every pure function
* every type grouping
* every internal subcomponent

### Use `Layer` only in

* `apps/api`
* test harnesses
* package-level live bundles when they are genuinely reusable

Do **not** rebuild the current “everything is a Layer” style.

## Exact package internals

## `core`

```text
src/
  domain/
  events/
  errors/
  ports/
  plugins/
  policies/
  types/
```

## `agent`

```text
src/
  conversation/
    engine.ts
    router.ts
    context-loader.ts
    turn-streamer.ts
  execution/
    planner.ts
    orchestrator.ts
    execution-graph.ts
    run-recorder.ts
  specialists/
  runtime/
```

## `plugins`

```text
src/
  memory/
  automations/
  integrations/
  browser-tools/
  computer-tools/
  index.ts
```

## `skills`

```text
src/
  discovery/
  loader/
  activation/
  prompt-bridge/
  sources/
```

## `channels`

```text
src/
  telegram/
    adapter.ts
    sender.ts
    decoder.ts
    reply-target.ts
    bot.ts
```

## `computer`

```text
src/
  provider/
  runtime/
  monitor/
  auth/
  callbacks/
  artifacts/
```

## What gets deleted

Delete these packages or fold them away:

* `@amby/connectors`
* `@amby/memory`
* `apps/cli`

Delete these architectural patterns:

* generic channel registry
* CLI channel abstraction
* giant `AgentService`
* giant `TaskSupervisor`
* `agent/tools/messaging.ts` as a mixed scheduling/settings/messaging bucket
* traces as the main domain abstraction

## Current-to-target mapping

* current `agent.ts` -> `agent/conversation/engine.ts` + `agent/execution/*` + `core` ports
* current `router.ts` -> `agent/conversation/router.ts`
* current `context/builder.ts` -> `agent/conversation/context-loader.ts`
* current `execution/*` -> mostly preserved but moved under `agent/execution`
* current `memory` package -> `plugins/memory`
* current `jobs` runner + scheduling tools -> `plugins/automations`
* current `connectors` package -> `plugins/integrations`
* current `browser` package -> stays `browser`
* current `computer` package -> stays `computer`, but split internally
* current Telegram bot code in `apps/api` -> `channels/telegram`
* current CLI code -> removed

## Migration plan

## Phase 0: freeze behavior

Write acceptance tests for:

* Telegram inbound -> assistant response
* thread reuse vs new thread
* memory save + recall
* reminder creation
* integration list/connect/disconnect
* computer task spawn/query/finalize
* Codex auth status/set/start/clear
* sandbox recovery after process restart

No rewrite starts before this.

## Phase 1: create new packages and boundaries

Create empty packages:

* `core`
* `agent`
* `plugins`
* `skills`
* `channels`

Retain:

* `auth`
* `env`
* `db`
* `browser`
* `computer`

No behavior moves yet.

## Phase 2: greenfield DB schema

Implement new schema in `db`.
Do not reuse old migrations.
Create repo interfaces in `core` and implementations in `db`.

## Phase 3: build `core`

Implement:

* entity types
* ports
* plugin registry contracts
* run/task event contracts
* error hierarchy

## Phase 4: build `agent`

Implement:

* `ConversationEngine`
* `ThreadRouter`
* `ContextLoader`
* `Planner`
* `Orchestrator`
* `RunRecorder`

Wire it only to fake/in-memory ports first.

## Phase 5: port provider packages

Adapt:

* `browser` to `core` browser port
* `computer` to `core` computer port

Important: `computer` must stop importing DB schema directly. Persistence belongs in `db`, not in the provider package.

## Phase 6: port built-in plugins

Port in this order:

1. memory
2. automations
3. integrations
4. browser-tools
5. computer-tools

## Phase 7: add `skills`

Implement:

* local filesystem discovery
* activation
* prompt bridge
* capability requirements

No remote skill install yet.

## Phase 8: move Telegram into `channels`

Port the Telegram bot and sender into `channels/telegram`.
Remove CLI code entirely.

## Phase 9: cut API over

`apps/api` becomes a composition root:

* build live layers
* expose HTTP endpoints
* boot Telegram adapter
* expose integration callback endpoints
* expose internal task event endpoints

## Phase 10: delete old code

Delete:

* old `AgentService`
* old `TaskSupervisor` entrypoint shape
* old connectors package
* old memory package
* old CLI app
* old generic channel registry

## Cutover criteria

The rewrite is complete only when these are true:

1. `apps/api` composes the new engine only.
2. Telegram messages never touch old `AgentService`.
3. No package imports `db/schema` outside `db`.
4. No provider SDK is imported from `agent`.
5. `connectors` and `memory` packages are gone.
6. `apps/cli` is gone.
7. A full Telegram turn produces:

    * one `run`
    * zero or more `run_events`
    * zero or more `tasks`
    * zero or more `task_events`
    * one or more user-visible `messages`
8. Skills can be discovered and activated from local `SKILL.md` folders.
9. One user can recover their main compute instance from durable volume state.

## The strongest recommendation

Do **not** treat this as “clean up the repo.”

Treat it as:

* a schema rewrite
* a runtime rewrite
* a package-boundary rewrite
* a plugin/skill split
* a Telegram-only simplification
