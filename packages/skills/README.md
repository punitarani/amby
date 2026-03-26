# @amby/skills

Filesystem-based skill discovery and activation for extending agent behavior.

## Responsibilities

- Discover skills from the `./skills` directory
- Parse `SKILL.md` front matter into `SkillManifest`
- Activate skills by loading full instructions and references
- Provide `SkillService` (Effect service) for skill management
- Provide the skills plugin (`list_skills`, `activate_skill` tools)

## Non-responsibilities

- No skill execution — skills are instruction bundles, not executable code
- No agent orchestration or tool dispatch
- No plugin registry ownership (that's `@amby/core`)

## Key modules

| Path | Description |
|------|-------------|
| `src/discovery/filesystem-discovery.ts` | Scan `./skills` directory, parse manifests |
| `src/discovery/skill-manifest.ts` | `SkillManifest`, `ActivatedSkill`, `SkillReference` types |
| `src/activation/skill-activation.ts` | Load full skill content, resolve references |
| `src/plugin.ts` | Skills plugin — registers `list_skills` and `activate_skill` tools |
| `src/skill-service.ts` | `SkillService` Effect service and `SkillServiceLive` layer |

## Public surface

```ts
import { createSkillsPlugin, SkillServiceLive, discoverSkills, activateSkill } from "@amby/skills"
import type { SkillManifest, ActivatedSkill } from "@amby/skills"
```

## Dependency rules

- **Depends on:** `@amby/core`
- **Depended on by:** `apps/api`

## Links

- [Plugins and Skills](../../docs/PLUGINS_AND_SKILLS.md)
- [Architecture](../../docs/ARCHITECTURE.md)
