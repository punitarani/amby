export { activateSkill } from "./activation/skill-activation"
export { discoverSkills } from "./discovery/filesystem-discovery"
export type { ActivatedSkill, SkillManifest, SkillReference } from "./discovery/skill-manifest"
export {
	createSkillService,
	type SkillService,
	type SkillServiceConfig,
	SkillServiceTag,
} from "./skill-service"
