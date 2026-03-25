export { activateSkill } from "./activation/skill-activation"
export { discoverSkills } from "./discovery/filesystem-discovery"
export type { ActivatedSkill, SkillManifest, SkillReference } from "./discovery/skill-manifest"
export { createSkillsPlugin } from "./plugin"
export {
	createSkillService,
	type SkillService,
	type SkillServiceConfig,
	SkillServiceLive,
	SkillServiceTag,
} from "./skill-service"
