# Documentation Index

`docs/` is the system of record for Amby's architecture, subsystems, and development practices.

## Reading order

Start here if you are new to the codebase:

1. [ARCHITECTURE.md](./ARCHITECTURE.md) — package graph, layers, dependency boundaries
2. [RUNTIME.md](./RUNTIME.md) — message flow, orchestration, lifecycle
3. [DATA_MODEL.md](./DATA_MODEL.md) — entities, relationships, ER diagram
4. [DEVELOPMENT.md](./DEVELOPMENT.md) — setup, commands, local dev

Then read subsystem docs as needed.

## Index

### Core architecture

- [ARCHITECTURE.md](./ARCHITECTURE.md) — package graph, layers, boundaries
- [RUNTIME.md](./RUNTIME.md) — message flow, orchestration, lifecycle
- [DATA_MODEL.md](./DATA_MODEL.md) — entities, relationships, ER diagram

### Subsystems

- [AGENT.md](./AGENT.md) — agent orchestration, tools, context
- [channels/telegram.md](./channels/telegram.md) — Telegram integration
- [PLUGINS_AND_SKILLS.md](./PLUGINS_AND_SKILLS.md) — plugin contract, skill system
- [BROWSER_AND_COMPUTER.md](./BROWSER_AND_COMPUTER.md) — browser and sandbox execution
- [MEMORY.md](./MEMORY.md) — memory system

### Operations and development

- [DEVELOPMENT.md](./DEVELOPMENT.md) — setup, commands, local dev

### Context

- [MARKET.md](./MARKET.md) — market context
- [MISSION.md](./MISSION.md) — mission statement

### Research

- [research/](./research/) — research references and external material

## Package READMEs

Each package under `packages/` and `apps/` has its own `README.md` with package-specific setup, API surface, and usage. Start there for package-level details.

## Maintenance

Update docs when code changes. If a subsystem's behavior shifts, the corresponding doc must be updated in the same PR.
