import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import type { ActivatedSkill, SkillManifest, SkillReference } from "../discovery/skill-manifest"

/**
 * Extract the body of a SKILL.md by removing frontmatter.
 */
function extractBody(content: string): string {
	const match = content.match(/^---\n[\s\S]*?\n---\n(.*)$/s)
	return match?.[1]?.trim() ?? content.trim()
}

/**
 * Load all reference files in a skill directory (excluding SKILL.md).
 */
async function loadReferences(skillPath: string): Promise<SkillReference[]> {
	const refs: SkillReference[] = []

	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir)
		for (const entry of entries) {
			if (entry === "SKILL.md") continue
			const fullPath = join(dir, entry)
			const s = await stat(fullPath).catch(() => null)
			if (!s) continue

			if (s.isDirectory()) {
				await walk(fullPath)
			} else if (s.isFile()) {
				const content = await readFile(fullPath, "utf-8").catch(() => null)
				if (content !== null) {
					refs.push({
						path: relative(skillPath, fullPath),
						content,
						type: entry.endsWith(".template") ? "template" : "file",
					})
				}
			}
		}
	}

	await walk(skillPath)
	return refs
}

/**
 * Activate a skill by loading its full SKILL.md content and referenced files.
 */
export async function activateSkill(manifest: SkillManifest): Promise<ActivatedSkill> {
	const skillMdPath = join(manifest.path, "SKILL.md")
	const content = await readFile(skillMdPath, "utf-8")
	const instructions = extractBody(content)
	const references = await loadReferences(manifest.path)

	return {
		id: manifest.id,
		title: manifest.title,
		instructions,
		references,
		requiredCapabilities: manifest.requiredCapabilities ?? [],
	}
}
