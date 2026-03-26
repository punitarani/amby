import type { AmbyPlugin, PluginRegistry } from "@amby/core"
import { tool } from "ai"
import { Effect } from "effect"
import { z } from "zod"
import type { SkillService } from "./skill-service"

/**
 * Create the skills plugin from a resolved SkillService instance.
 *
 * The plugin:
 * - Contributes context: discovered skill summaries as planner hints
 * - Provides tools: list_skills (discover available skills), activate_skill (load instructions)
 */
export function createSkillsPlugin(service: SkillService): AmbyPlugin {
	return {
		id: "skills",

		register(registry: PluginRegistry) {
			registry.addContextContributor({
				id: "skills:available",
				contribute: async () => {
					const manifests = await Effect.runPromise(service.discover()).catch(() => [])
					if (manifests.length === 0) return undefined
					const lines = manifests.map((m) => `- **${m.title}**: ${m.description}`)
					return `## Available Skills\n${lines.join("\n")}`
				},
			})

			registry.addToolProvider({
				id: "skills:tools",
				group: "settings",
				getTools: async () => ({
					list_skills: tool({
						description:
							"List all available skills that can be activated for specialized workflows.",
						inputSchema: z.object({
							query: z.string().optional().describe("Optional search query to filter skills"),
						}),
						execute: async ({ query }) => {
							const manifests = query
								? await Effect.runPromise(service.search(query))
								: await Effect.runPromise(service.discover())
							return manifests.map((m) => ({
								id: m.id,
								title: m.title,
								description: m.description,
								requiredCapabilities: m.requiredCapabilities,
							}))
						},
					}),

					activate_skill: tool({
						description:
							"Activate a skill by its id. Returns the skill instructions and references to inject into the current turn context.",
						inputSchema: z.object({
							skillId: z.string().describe("The skill id to activate"),
						}),
						execute: async ({ skillId }) => {
							const manifest = await Effect.runPromise(service.findById(skillId))
							if (!manifest) {
								return { error: `Skill not found: ${skillId}` }
							}
							const activated = await Effect.runPromise(service.activate(manifest))
							return {
								title: activated.title,
								instructions: activated.instructions,
								references: activated.references.map((r) => ({
									path: r.path,
									type: r.type,
								})),
							}
						},
					}),
				}),
			})

			registry.addPlannerHintProvider({
				id: "skills:hints",
				getHints: async () => {
					const manifests = await Effect.runPromise(service.discover()).catch(() => [])
					if (manifests.length === 0) return undefined
					return `Available skills: ${manifests.map((m) => m.title).join(", ")}. Use list_skills and activate_skill to leverage them.`
				},
			})
		},
	}
}
