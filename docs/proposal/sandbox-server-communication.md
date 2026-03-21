You already have **server → sandbox control**, but you do **not** appear to have a real **sandbox/computer → server event channel** for task execution yet.

A few concrete findings from your code/docs:

* Your current sandbox runtime is centered around `SandboxService.ensure/exec/readFile/writeFile/stop` over Daytona. That is control-plane only; there is no obvious callback/event API in the current implementation ([`packages/computer/src/sandbox/service.ts`](https://github.com/punitarani/amby/blob/main/packages/computer/src/sandbox/service.ts)).
* Your `sandboxes` table stores per-user sandbox identity, status, auth config, and last activity, but not task-execution state, callback auth, or event sequencing ([`packages/db/src/schema/sandboxes.ts`](https://github.com/punitarani/amby/blob/main/packages/db/src/schema/sandboxes.ts)).
* You already have durable server-side infrastructure with Cloudflare Workers/Queues/Workflows, and you already use a workflow for sandbox provisioning, which is a very good fit for reconciliation and probe jobs ([`docs/ARCHITECTURE.md`](https://github.com/punitarani/amby/blob/main/docs/ARCHITECTURE.md), [`apps/api/src/workflows/sandbox-provision.ts`](https://github.com/punitarani/amby/blob/main/apps/api/src/workflows/sandbox-provision.ts)).
* Your `docs/COMPUTER.md` describes a richer task system with `delegate_task`, `get_task`, `TaskSupervisor`, heartbeats, sessions, and a `tasks` table, but from the repo search that looks more like **intended architecture than finished implementation** right now ([`docs/COMPUTER.md`](https://github.com/punitarani/amby/blob/main/docs/COMPUTER.md)).

My blunt take: don’t overengineer this into “distributed eventing.” You need a tiny, boring, zero-trust **task control plane**.

## What to build

Build a **hybrid model**:

1. **Sandbox pushes signed task events to a single callback endpoint**
2. **Server remains the source of truth and periodically reconciles by probing Daytona**
3. **Each task also writes a local `status.json` + logs/artifacts in the sandbox**
4. **Clients poll the server for status**; no websockets

That is the right shape.

***

## Option 1: Pure server polling / probing

The server never accepts callbacks from the sandbox. It just polls Daytona/session state and reads files/logs/artifacts.

### How it works

* Start task
* Save `taskId`, `sandboxId`, `sessionId`, `commandId`
* Poll every N seconds
* On each poll:

  * refresh sandbox/session metadata
  * inspect command state
  * read `stderr.log`, `result.md`, optional `status.json`
  * update DB

### Benefits

* Simplest trust model
* No inbound auth endpoint needed
* Server is fully authoritative
* Harder for a compromised sandbox to spoof completion

### Tradeoffs

* Worse latency
* More Daytona/API load
* Progress UX is mediocre
* You only learn things on the next poll
* Harder to surface rich intermediate state cleanly

### Verdict

Good fallback. Bad primary mechanism.

***

## Option 2: Pure signed webhook from sandbox

The sandbox posts `started`, `heartbeat`, `progress`, `completed`, `failed` straight to your server.

### How it works

* Server mints per-task callback secret
* Secret is injected into the sandbox env/files
* Wrapper script posts JSON events to `/internal/task-events`

### Benefits

* Fast
* Cheap
* Very simple mental model
* Great UX for immediate completion/failure updates

### Tradeoffs

* Not enough by itself in a zero-trust model
* Missed callback = stale task
* Retried/out-of-order events need idempotency
* A compromised sandbox can lie unless the server reconciles

### Verdict

Good transport. Bad source of truth.

***

## Option 3: Queue-based producer from sandbox

Sandbox publishes to a queue instead of hitting your app directly.

Examples in principle: Cloudflare Queues REST, SQS, NATS, etc.

### Benefits

* Better delivery durability
* Natural retry buffering
* Decouples callback ingestion from task update logic

### Tradeoffs

* More credentials in the sandbox
* More infrastructure
* More moving parts for a feature that does not need them yet
* Awkward in a strict zero-trust story unless you still scope credentials per task

### Verdict

Overkill for v1.

***

## Final recommended design

### Use this:

**Task-scoped signed callback + authoritative server reconciliation**

This gives you the elegance of webhooks without the stupidity of trusting them.

### The rule

The sandbox is a **reporter**, not an authority.

The server accepts events, updates fast-moving state, and then reconciles against Daytona and artifacts whenever something looks wrong or stale.

***

## Concrete design

## 1) Add a real `tasks` table

You already describe one in `COMPUTER.md`. Build it for real.

Use first-class columns for hot state and JSONB only for extras.

Suggested fields:

* `id`
* `user_id`
* `provider`
* `status`
* `sandbox_id`
* `session_id`
* `command_id`
* `artifact_root`
* `callback_token_hash`
* `callback_token_expires_at`
* `last_event_seq`
* `last_heartbeat_at`
* `last_probe_at`
* `started_at`
* `completed_at`
* `exit_code`
* `output_summary`
* `error`
* `runtime_metadata jsonb`

And add a separate append-only `task_events` table:

* `id`
* `task_id`
* `seq`
* `event_type`
* `received_at`
* `payload jsonb`
* unique `(task_id, seq)`

That one table saves your ass later.

***

## 2) Mint a per-task opaque callback secret

Do **not** use a reusable sandbox token.
Do **not** use DB credentials in the sandbox.
Do **not** use JWT as the only credential.

Use a random opaque secret per task:

* 32 bytes random
* store **hash only** in DB
* inject raw secret into sandbox as env/file
* revoke it when the task finishes

Example env in sandbox:

* `AMBY_TASK_ID`
* `AMBY_CALLBACK_URL`
* `AMBY_CALLBACK_SECRET`
* `AMBY_EVENT_SEQ_START=1`

***

## 3) Use a single callback endpoint

Example:

`POST /internal/task-events`

Headers:

* `Authorization: Bearer <task-secret>` or skip bearer and use HMAC only
* `X-Amby-Task-Id: <taskId>`
* `X-Amby-Timestamp: <unix ms>`
* `X-Amby-Seq: <monotonic integer>`
* `X-Amby-Signature: sha256=<hmac(rawBody, taskSecret)>`
* `Idempotency-Key: <uuid>`

Body:

```json
{
  "eventType": "task.progress",
  "taskId": "uuid",
  "sandboxId": "sbx_123",
  "sessionId": "sess_123",
  "commandId": "cmd_123",
  "seq": 4,
  "status": "running",
  "message": "Running test suite",
  "progress": 0.6,
  "exitCode": null,
  "artifactRoot": "/home/agent/workspace/tasks/...",
  "meta": {
    "cwd": "/home/agent/workspace/tasks/123/workspace"
  },
  "sentAt": "2026-03-20T19:00:00Z"
}
```

### Verification rules

* look up task by `taskId`
* compare hash of presented secret
* verify HMAC over raw body
* reject if timestamp skew > 5 min
* reject if task already terminal
* ignore duplicate or lower `seq`
* write event to `task_events`
* update `tasks`

That is enough. Clean and hard to abuse.

***

## 4) Make the sandbox write local status files too

This is the piece most people forget.

For each task, write:

* `artifacts/status.json`
* `artifacts/stderr.log`
* `artifacts/result.md`
* optionally `artifacts/progress.ndjson`

Why this matters:

* if callback fails, the server can still probe
* if task crashes, you still have local forensic state
* if you need to debug weird jobs, you inspect the sandbox directly

Example `status.json`:

```json
{
  "taskId": "uuid",
  "status": "running",
  "seq": 4,
  "updatedAt": "2026-03-20T19:00:00Z",
  "message": "Running test suite",
  "exitCode": null
}
```

This gives you a second signal without trusting the sandbox as authority.

***

## 5) Reconciliation loop on the server

This is mandatory.

Run a lightweight workflow/cron/queue consumer every 30–60 seconds for `running` tasks:

* if `last_heartbeat_at` is fresh, do nothing
* if stale:

  * probe Daytona sandbox/session/command
  * inspect local `status.json`
  * inspect `stderr.log` / `result.md`
  * decide:

    * still running
    * completed
    * failed
    * timed out
    * lost

### Mark a task stale when:

* no heartbeat for 2–3 minutes
* seq stops moving
* command/session missing unexpectedly
* sandbox archived/stopped while task marked running

### This gives you:

* resilience to dropped callbacks
* protection from sandbox lies
* recovery after worker restarts

Your existing workflow infrastructure is already a natural place for this ([`docs/ARCHITECTURE.md`](https://github.com/punitarani/amby/blob/main/docs/ARCHITECTURE.md), [`apps/api/src/workflows/sandbox-provision.ts`](https://github.com/punitarani/amby/blob/main/apps/api/src/workflows/sandbox-provision.ts)).

***

## 6) Add proper probe APIs

You explicitly said you also want to “probe into a sandbox/task and learn about its status.”

You need three server APIs:

### `get_task(taskId)`

Cheap DB read.
Used by product/UI/agent tools.

Returns:

* status
* summary
* last heartbeat
* exit code
* error
* last message
* completion timestamps

### `probe_task(taskId)`

Forces reconciliation now.

Does:

* refresh sandbox metadata
* inspect session/command
* read status/log/artifact files
* update task row
* return the refreshed answer

### `get_task_artifacts(taskId)`

Lists artifact files and metadata.

Optional:

### `get_task_log(taskId, cursor)`

Returns paginated log tail without websockets.

That is enough.

***

## 7) Use a tiny wrapper script inside the sandbox

Do not have Codex call your endpoint directly in random ways.

Wrap execution in one script that owns:

* sending `started`
* periodic `heartbeat`
* optional `progress`
* sending `completed` or `failed`
* writing `status.json`

Flow:

1. write `status.json: preparing`
2. callback `task.started`
3. launch codex
4. every 30–60s:

   * update `status.json`
   * callback `task.heartbeat`
5. on success:

   * write `result.md`
   * write `status.json: succeeded`
   * callback `task.completed`
6. on failure:

   * write `stderr.log`
   * write `status.json: failed`
   * callback `task.failed`

That wrapper is the whole feature.

***

## Recommended auth model

Your instinct about “simple secret token sent per task, identifiable by ID and stored in DB” is right.

But do it correctly:

### Good

* opaque random per-task secret
* store hash only
* include task ID separately
* HMAC-sign body
* timestamp + seq for replay protection
* expire token when task ends

### Bad

* one secret per sandbox
* token in query params
* JWT only, with no DB check
* direct DB access from sandbox
* trusting callback completion without reconciliation

***

## How this fits your current repo

Right now the repo already supports:

* per-user sandbox lifecycle
* persisted sandbox metadata
* durable server workflows
* server-driven sandbox execution paths

But it does **not** yet look like it has:

* a real task table in code
* a callback channel from sandbox to server
* task event logging
* explicit task probe APIs
* authoritative reconciliation for running async tasks

That’s why I would not frame this as “add a webhook.”
I would frame it as:

**Add a task runtime control plane with callback ingestion + reconciliation.**

That is the actual system.

***

## My final recommendation

Build this in v1:

### Core

* `tasks` table
* `task_events` table
* per-task callback secret
* one callback endpoint
* wrapper script in sandbox
* server reconciliation loop
* `get_task` + `probe_task` + `get_task_artifacts`

### Explicit product stance

* no websockets
* no direct sandbox→DB access
* no queue-from-sandbox for v1
* no trust in sandbox-reported terminal state without reconciliation

### Why this is the best choice

* elegant
* minimal
* zero-trust enough for reality
* debuggable
* works with your Cloudflare + Daytona stack
* scales from one task to many
* easy to extend into notifications later

The wrong move here would be building either:

* pure polling only, which is clunky, or
* pure webhook trust, which is naive.

The hybrid is the right answer.
