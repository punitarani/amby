import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { SkillManifest } from "./skill-manifest"

/**
 * Parse SKILL.md frontmatter to extract metadata.
 * Frontmatter is delimited by --- markers at the top of the file.
 */
function parseFrontmatter(content: string): {
	title?: string
	description?: string
	requiredCapabilities?: string[]
} {
	const match = content.match(/^---\n([\s\S]*?)\n---/)
	if (!match?.[1]) return {}

	const frontmatter = match[1]
	const result: Record<string, unknown> = {}

	for (const line of frontmatter.split("\n")) {
		const colonIdx = line.indexOf(":")
		if (colonIdx === -1) continue
		const key = line.slice(0, colonIdx).trim()
		const value = line.slice(colonIdx + 1).trim()

		if (key === "requiredCapabilities") {
			result[key] = value
				.replace(/^\[/, "")
				.replace(/\]$/, "")
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean)
		} else {
			result[key] = value.replace(/^["']|["']$/g, "")
		}
	}

	return result as {
		title?: string
		description?: string
		requiredCapabilities?: string[]
	}
}

/**
 * Discover skills by scanning a directory for SKILL.md files.
 * Each immediate subdirectory with a SKILL.md is treated as a skill.
 */
export async function discoverSkills(skillsDir: string): Promise<SkillManifest[]> {
	const manifests: SkillManifest[] = []

	let entries: string[]
	try {
		entries = await readdir(skillsDir)
	} catch {
		return []
	}

	for (const entry of entries) {
		const entryPath = join(skillsDir, entry)
		const entryStat = await stat(entryPath).catch(() => null)
		if (!entryStat?.isDirectory()) continue

		const skillMdPath = join(entryPath, "SKILL.md")
		const content = await readFile(skillMdPath, "utf-8").catch(() => null)
		if (!content) continue

		const meta = parseFrontmatter(content)

		manifests.push({
			id: entry,
			title: meta.title ?? entry,
			description: meta.description ?? "",
			path: entryPath,
			requiredCapabilities: meta.requiredCapabilities,
		})
	}

	return manifests
}
