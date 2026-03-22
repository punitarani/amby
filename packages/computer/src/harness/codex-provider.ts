import type { Sandbox } from "@daytonaio/sdk"
import { CODEX_HOME, TASK_BASE } from "../config"
import type { TaskConfig, TaskProvider, TaskResult } from "./provider"
import { buildCallbackJsScript, buildNotifyJsScript, buildRunShScript } from "./wrapper-script"

const AGENTS_MD = `# Task Instructions

You are a background agent executing a delegated task. Work autonomously to completion.

## Output Requirements
- Your final message will be captured as the task result — make it complete and well-formatted
- Save any generated files, data, or screenshots to ../artifacts/
- Be thorough and complete — there is no follow-up interaction
`

const PLAYWRIGHT_CONFIG = `[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--browser", "chromium", "--isolated"]
startup_timeout_sec = 30
`

/** Avoid loading huge artifacts into memory (pathological stdout/stderr). */
const MAX_ARTIFACT_BYTES = 1024 * 1024
const HEAD_TAIL_BYTES = 10 * 1024

function trimTrailingReplacement(s: string): string {
	let end = s.length
	while (end > 0 && s[end - 1] === "\uFFFD") end--
	return end === s.length ? s : s.slice(0, end)
}

function trimLeadingReplacement(s: string): string {
	let start = 0
	while (start < s.length && s[start] === "\uFFFD") start++
	return start === 0 ? s : s.slice(start)
}

function utf8SizeLimited(buf: Buffer): string {
	if (buf.length <= MAX_ARTIFACT_BYTES) {
		return buf.toString("utf-8")
	}
	const head = trimTrailingReplacement(buf.subarray(0, HEAD_TAIL_BYTES).toString("utf-8"))
	const tail = trimLeadingReplacement(buf.subarray(buf.length - HEAD_TAIL_BYTES).toString("utf-8"))
	return `${head}\n\n… [truncated ${buf.length} bytes] …\n\n${tail}`
}

function buildCodexConfigToml(needsBrowser: boolean, includeNotify: boolean): string {
	const parts: string[] = []
	if (includeNotify) {
		parts.push(`notify = ["node", "../notify.js"]`)
	}
	if (needsBrowser) {
		parts.push(PLAYWRIGHT_CONFIG.trim())
	}
	return parts.join("\n\n")
}

async function downloadText(sandbox: Sandbox, path: string): Promise<string> {
	const buf = await sandbox.fs.downloadFile(path)
	return utf8SizeLimited(buf)
}

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

		const hasCallback = Boolean(config.callbackUrl && config.callbackSecret && config.callbackId)

		// Write .codex/config.toml (Playwright + optional Codex notify hook)
		const configToml = buildCodexConfigToml(config.needsBrowser, hasCallback)
		if (configToml.trim().length > 0) {
			await sandbox.fs.uploadFile(Buffer.from(configToml), `${workspaceDir}/.codex/config.toml`)
		}

		// Write AGENTS.md
		const agentsContent = config.instructions ? `${AGENTS_MD}\n${config.instructions}\n` : AGENTS_MD
		await sandbox.fs.uploadFile(Buffer.from(agentsContent), `${workspaceDir}/AGENTS.md`)

		// Write prompt to file (avoids shell injection)
		await sandbox.fs.uploadFile(Buffer.from(config.prompt), `${workspaceDir}/prompt.txt`)

		// Callback scripts + orchestrator
		await sandbox.fs.uploadFile(Buffer.from(buildCallbackJsScript()), `${taskDir}/callback.js`)
		if (hasCallback) {
			await sandbox.fs.uploadFile(Buffer.from(buildNotifyJsScript()), `${taskDir}/notify.js`)
		}
		await sandbox.fs.uploadFile(Buffer.from(buildRunShScript()), `${taskDir}/run.sh`)

		const envLines = [`CODEX_HOME=${CODEX_HOME}`, `AMBY_TASK_ID=${config.taskId}`]
		if (hasCallback) {
			envLines.push(`AMBY_CALLBACK_URL=${config.callbackUrl}`)
			envLines.push(`AMBY_CALLBACK_ID=${config.callbackId}`)
			envLines.push(`AMBY_CALLBACK_SECRET=${config.callbackSecret}`)
			envLines.push("AMBY_EVENT_SEQ_START=1")
		}
		await sandbox.fs.uploadFile(Buffer.from(`${envLines.join("\n")}\n`), `${taskDir}/.env`)

		return `cd ${taskDir} && chmod +x run.sh callback.js${hasCallback ? " notify.js" : ""} && sh run.sh`
	}

	async collectResult(sandbox: Sandbox, artifactRoot: string): Promise<TaskResult> {
		const output = await downloadText(sandbox, `${artifactRoot}/result.md`).catch((e) => {
			console.warn("[CodexProvider] failed to download result.md:", e)
			return ""
		})

		const stderr = await downloadText(sandbox, `${artifactRoot}/stderr.log`).catch((e) => {
			console.warn("[CodexProvider] failed to download stderr.log:", e)
			return ""
		})

		// Generate summary (first 500 chars or first paragraph)
		const summary = output
			? (output.slice(0, 500).split("\n\n")[0] ?? output.slice(0, 500))
			: stderr
				? `Task failed: ${stderr.slice(0, 200)}`
				: "No output produced"

		return { output, summary, stderr }
	}

	getArtifactRoot(taskId: string): string {
		return `${TASK_BASE}/${taskId}/artifacts`
	}
}
