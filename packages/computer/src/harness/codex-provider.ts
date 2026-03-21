import type { Sandbox } from "@daytonaio/sdk"
import { CODEX_HOME, TASK_BASE } from "../config"
import type { TaskConfig, TaskProvider, TaskResult } from "./provider"
import { buildWrapperScript } from "./wrapper-script"

const AGENTS_MD = `# Task Instructions

You are a background agent executing a delegated task. Work autonomously to completion.

## Output Requirements
- Write your final output to ../artifacts/result.md
- Save any generated files, data, or screenshots to ../artifacts/
- Be thorough and complete — there is no follow-up interaction
`

const PLAYWRIGHT_CONFIG = `[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--browser", "chromium", "--isolated"]
startup_timeout_sec = 30
`

export class CodexProvider implements TaskProvider {
	readonly name = "codex"

	async prepareAndBuildCommand(sandbox: Sandbox, config: TaskConfig): Promise<string> {
		const taskDir = `${TASK_BASE}/${config.taskId}`
		const workspaceDir = `${taskDir}/workspace`
		const artifactsDir = `${taskDir}/artifacts`

		// Create directory structure
		await sandbox.process.executeCommand(`mkdir -p ${workspaceDir}/.codex ${artifactsDir}`)

		// Initialize git repo (Codex requires it)
		await sandbox.process.executeCommand(`cd ${workspaceDir} && git init`)

		// Write .codex/config.toml if browser is needed
		if (config.needsBrowser) {
			await sandbox.fs.uploadFile(
				Buffer.from(PLAYWRIGHT_CONFIG),
				`${workspaceDir}/.codex/config.toml`,
			)
		}

		// Write AGENTS.md
		const agentsContent = config.instructions ? `${AGENTS_MD}\n${config.instructions}\n` : AGENTS_MD
		await sandbox.fs.uploadFile(Buffer.from(agentsContent), `${workspaceDir}/AGENTS.md`)

		// Write prompt to file (avoids shell injection)
		await sandbox.fs.uploadFile(Buffer.from(config.prompt), `${workspaceDir}/prompt.txt`)

		// Codex auth lives in CODEX_HOME/auth.json inside the sandbox.
		const envLines = [
			`CODEX_HOME=${CODEX_HOME}`,
			`AMBY_TASK_ID=${config.taskId}`,
			`AMBY_EVENT_SEQ_START=1`,
		]
		if (config.callbackUrl?.trim() && config.callbackSecret?.trim()) {
			envLines.push(`AMBY_CALLBACK_URL=${config.callbackUrl.trim()}`)
			envLines.push(`AMBY_CALLBACK_SECRET=${config.callbackSecret.trim()}`)
		}
		await sandbox.fs.uploadFile(Buffer.from(`${envLines.join("\n")}\n`), `${taskDir}/.env`)

		// Wrapper: optional callbacks + status.json + heartbeats; falls back to no-op sends when URL unset.
		const runScript = buildWrapperScript()
		await sandbox.fs.uploadFile(Buffer.from(runScript), `${taskDir}/run.sh`)

		return `cd ${taskDir} && sh run.sh`
	}

	async collectResult(sandbox: Sandbox, artifactRoot: string): Promise<TaskResult> {
		let output = ""
		try {
			const buf = await sandbox.fs.downloadFile(`${artifactRoot}/result.md`)
			output = buf.toString("utf-8")
		} catch {
			// result.md may not exist if codex failed early
		}

		let stderr = ""
		try {
			const buf = await sandbox.fs.downloadFile(`${artifactRoot}/stderr.log`)
			stderr = buf.toString("utf-8")
		} catch {
			// stderr.log may not exist
		}

		// Generate summary (first 500 chars or first paragraph)
		const summary = output
			? (output.slice(0, 500).split("\n\n")[0] ?? output.slice(0, 500))
			: stderr
				? `Task failed: ${stderr.slice(0, 200)}`
				: "No output produced"

		return { output, summary }
	}

	getArtifactRoot(taskId: string): string {
		return `${TASK_BASE}/${taskId}/artifacts`
	}
}
