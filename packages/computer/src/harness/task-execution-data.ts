import type { Sandbox } from "@daytonaio/sdk"
import type { TaskProvider } from "./provider"

export type TaskArtifactFile = {
	name: string
	size: number
}

export type PersistedTaskArtifact = {
	kind: "file"
	title: string
	uri: string
	metadata: {
		size: number
	}
}

export type TaskExecutionData = {
	output: string
	summary: string
	files: TaskArtifactFile[]
	artifacts: PersistedTaskArtifact[]
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`
}

async function listTaskArtifactFiles(
	sandbox: Sandbox,
	artifactRoot: string,
): Promise<TaskArtifactFile[]> {
	const listed = await sandbox.process.executeCommand(
		`find ${shellQuote(artifactRoot)} -maxdepth 1 -type f -printf "%f\\t%s\\n" 2>/dev/null || true`,
	)
	const files: TaskArtifactFile[] = []

	for (const line of listed.result.split("\n")) {
		if (!line.includes("\t")) continue
		const [name, sizeStr] = line.split("\t")
		if (!name) continue
		const size = Number(sizeStr)
		if (!Number.isFinite(size)) continue
		files.push({ name, size })
	}

	return files
}

function buildArtifactRefs(
	artifactRoot: string,
	files: TaskArtifactFile[],
): PersistedTaskArtifact[] {
	return files.map((file) => ({
		kind: "file",
		title: file.name,
		uri: `${artifactRoot}/${file.name}`,
		metadata: {
			size: file.size,
		},
	}))
}

export async function collectTaskExecutionData(params: {
	sandbox: Sandbox
	provider: TaskProvider
	taskId: string
	artifactRoot: string
}): Promise<TaskExecutionData> {
	const [result, files] = await Promise.all([
		params.provider.collectResult(params.sandbox, params.artifactRoot),
		listTaskArtifactFiles(params.sandbox, params.artifactRoot),
	])

	return {
		output: result.output,
		summary: result.summary,
		files,
		artifacts: buildArtifactRefs(params.artifactRoot, files),
	}
}

export function previewTaskOutput(output: string, maxChars = 2000): string | undefined {
	const trimmed = output.trim()
	if (!trimmed) return undefined
	return trimmed.slice(0, maxChars)
}
