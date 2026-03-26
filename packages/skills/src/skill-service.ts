import type { CoreError } from "@amby/core"
import { Context, Effect, Layer } from "effect"
import { activateSkill } from "./activation/skill-activation"
import { discoverSkills } from "./discovery/filesystem-discovery"
import type { ActivatedSkill, SkillManifest } from "./discovery/skill-manifest"

export interface SkillServiceConfig {
	readonly skillsDir: string
}

export interface SkillService {
	/**
	 * Discover all available skills by scanning the skills directory.
	 * Returns lightweight manifests (no full content loaded).
	 */
	readonly discover: () => Effect.Effect<SkillManifest[], CoreError>

	/**
	 * Activate a skill by loading its full SKILL.md and references.
	 */
	readonly activate: (manifest: SkillManifest) => Effect.Effect<ActivatedSkill, CoreError>

	/**
	 * Find a skill by id from the discovered manifests.
	 */
	readonly findById: (id: string) => Effect.Effect<SkillManifest | undefined, CoreError>

	/**
	 * Search skills by keyword match against title and description.
	 */
	readonly search: (query: string) => Effect.Effect<SkillManifest[], CoreError>
}

export class SkillServiceTag extends Context.Tag("SkillService")<SkillServiceTag, SkillService>() {}

/**
 * Create a SkillService backed by filesystem discovery.
 */
export function createSkillService(config: SkillServiceConfig): SkillService {
	let cachedManifests: SkillManifest[] | null = null

	const loadManifests = async (): Promise<SkillManifest[]> => {
		if (!cachedManifests) {
			cachedManifests = await discoverSkills(config.skillsDir)
		}
		return cachedManifests
	}

	return {
		discover: () =>
			Effect.tryPromise({
				try: () => loadManifests(),
				catch: (e) => ({
					_tag: "CoreError" as const,
					message: "Failed to discover skills",
					cause: e,
				}),
			}) as Effect.Effect<SkillManifest[], CoreError>,

		activate: (manifest) =>
			Effect.tryPromise({
				try: () => activateSkill(manifest),
				catch: (e) => ({
					_tag: "CoreError" as const,
					message: `Failed to activate skill: ${manifest.id}`,
					cause: e,
				}),
			}) as Effect.Effect<ActivatedSkill, CoreError>,

		findById: (id) =>
			Effect.tryPromise({
				try: async () => {
					const manifests = await loadManifests()
					return manifests.find((m) => m.id === id)
				},
				catch: (e) => ({ _tag: "CoreError" as const, message: "Failed to find skill", cause: e }),
			}) as Effect.Effect<SkillManifest | undefined, CoreError>,

		search: (query) =>
			Effect.tryPromise({
				try: async () => {
					const manifests = await loadManifests()
					const q = query.toLowerCase()
					return manifests.filter(
						(m) => m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
					)
				},
				catch: (e) => ({
					_tag: "CoreError" as const,
					message: "Failed to search skills",
					cause: e,
				}),
			}) as Effect.Effect<SkillManifest[], CoreError>,
	}
}

/**
 * Effect Layer that provides SkillService from a SkillServiceConfig.
 */
export const SkillServiceLive = (config: SkillServiceConfig) =>
	Layer.succeed(SkillServiceTag, createSkillService(config))
