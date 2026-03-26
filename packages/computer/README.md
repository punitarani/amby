# @amby/computer

Sandbox task execution and volume management via Daytona.

## Responsibilities

- Provision and manage sandboxes (disposable runtimes on durable per-user volumes)
- Supervise task execution with heartbeat, state tracking, and result collection
- Provide sandbox tools (`execute_in_sandbox`, CUA tools) as AI SDK tool definitions
- Resolve sandbox and volume state for users
- Export sandbox configuration for external consumers

## Non-responsibilities

- No tool registration with the agent (tool wiring is in `@amby/agent`)
- No task persistence to database (that is `@amby/db` via the agent layer)
- No agent orchestration or planning

## Key modules

| File | Purpose |
|---|---|
| `src/sandbox/service.ts` | Sandbox provisioning and lifecycle management |
| `src/sandbox/tools.ts` | AI SDK tool definitions for sandbox execution |
| `src/sandbox/resolve-sandbox.ts` | Sandbox state resolution |
| `src/sandbox/resolve-volume.ts` | Volume state resolution |
| `src/harness/supervisor.ts` | Task supervision, heartbeat, result collection |
| `src/harness/task-state.ts` | Task state machine |
| `src/harness/provider.ts` | Harness provider |
| `src/config.ts` | Sandbox configuration |
| `src/sandbox-config.ts` | Exported sandbox config |

## Public surface

Exported from `src/index.ts`: `SandboxService`, `TaskSupervisor`, `createComputerTools`, `createCuaTools`, harness utilities, config, and error types. Separate `"./sandbox-config"` export for external config consumers.

## Dependency rules

- **Depends on:** `@amby/core`, `@amby/db`, `@amby/env`
- **Depended on by:** `@amby/agent`

## Links

- [Architecture](../../docs/ARCHITECTURE.md)
