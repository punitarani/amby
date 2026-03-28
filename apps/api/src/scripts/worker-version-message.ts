const CLOUDFLARE_WORKER_VERSION_MESSAGE_LIMIT = 100
const WORKER_VERSION_MESSAGE_ELLIPSIS = "..."
const DEFAULT_WORKER_VERSION_MESSAGE = "amby-api deploy"

type GitReader = (args: string[]) => string | undefined

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim()
}

export function normalizeWorkerVersionMessage(
	value: string,
	limit = CLOUDFLARE_WORKER_VERSION_MESSAGE_LIMIT,
): string {
	const normalized = collapseWhitespace(value)
	if (!normalized) return DEFAULT_WORKER_VERSION_MESSAGE
	if (normalized.length <= limit) return normalized
	if (limit <= WORKER_VERSION_MESSAGE_ELLIPSIS.length) return normalized.slice(0, limit)

	return `${normalized.slice(0, limit - WORKER_VERSION_MESSAGE_ELLIPSIS.length).trimEnd()}${WORKER_VERSION_MESSAGE_ELLIPSIS}`
}

function readGitStdout(args: string[]): string | undefined {
	const result = Bun.spawnSync({
		cmd: ["git", ...args],
		stderr: "ignore",
		stdout: "pipe",
	})

	if (result.exitCode !== 0) return undefined

	const value = new TextDecoder().decode(result.stdout).trim()
	return value ? value : undefined
}

function buildShaFallbackMessage(commitSha?: string): string {
	return commitSha ? `${DEFAULT_WORKER_VERSION_MESSAGE} ${commitSha}` : DEFAULT_WORKER_VERSION_MESSAGE
}

export function resolveWorkerVersionMessage(
	env: Record<string, string | undefined> = process.env,
	readGit: GitReader = readGitStdout,
): string {
	const overrideMessage = collapseWhitespace(env.WORKER_VERSION_MESSAGE ?? "")
	if (overrideMessage) return normalizeWorkerVersionMessage(overrideMessage)

	const commitSubject = collapseWhitespace(readGit(["log", "-1", "--pretty=%s"]) ?? "")
	if (commitSubject) return normalizeWorkerVersionMessage(commitSubject)

	return normalizeWorkerVersionMessage(
		buildShaFallbackMessage(readGit(["rev-parse", "--short", "HEAD"])),
	)
}

if (import.meta.main) {
	console.log(resolveWorkerVersionMessage())
}

export { CLOUDFLARE_WORKER_VERSION_MESSAGE_LIMIT }
