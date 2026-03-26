/**
 * A SkillManifest is the lightweight metadata extracted from a SKILL.md file.
 * Only the frontmatter is parsed during discovery — the full instructions
 * are loaded only at activation time.
 */
export interface SkillManifest {
	readonly id: string
	readonly title: string
	readonly description: string
	readonly path: string
	readonly requiredCapabilities?: string[]
}

/**
 * An ActivatedSkill contains the full content loaded from SKILL.md
 * plus any referenced files. This is what the orchestrator uses.
 */
export interface ActivatedSkill {
	readonly id: string
	readonly title: string
	readonly instructions: string
	readonly references: SkillReference[]
	readonly requiredCapabilities: string[]
}

export interface SkillReference {
	readonly path: string
	readonly content: string
	readonly type: "file" | "template"
}
