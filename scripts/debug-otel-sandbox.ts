/**
 * Debug OTEL config in a sandbox for a given task.
 * Run with: doppler run -- bun run scripts/debug-otel-sandbox.ts <taskId>
 */

import postgres from "../packages/db/node_modules/postgres/src/index.js"
import { Daytona } from "../packages/computer/node_modules/@daytonaio/sdk"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error("❌ DATABASE_URL not set"); process.exit(1) }

const taskId = process.argv[2]
if (!taskId) { console.error("Usage: bun run scripts/debug-otel-sandbox.ts <taskId>"); process.exit(1) }

const sql = postgres(DATABASE_URL, { max: 1 })
const rows = await sql`SELECT id, status, sandbox_id, metadata FROM tasks WHERE id = ${taskId} LIMIT 1`
await sql.end()

const task = rows[0]
if (!task) { console.error(`No task found: ${taskId}`); process.exit(1) }
console.log(`Task:      ${task.id}`)
console.log(`Status:    ${task.status}`)
console.log(`Sandbox:   ${task.sandbox_id}`)
console.log(`Metadata:  ${JSON.stringify(task.metadata)}`)

const daytonaApiKey = process.env.DAYTONA_API_KEY ?? ""
const daytonaApiUrl = process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api"
const daytona = new Daytona({ apiKey: daytonaApiKey, serverUrl: daytonaApiUrl })

const sandboxes = await daytona.list()
const items = (sandboxes as { items?: unknown[] }).items ?? []
const sandbox = items.find((s) => (s as { id: string }).id === task.sandbox_id) as {
	id: string
	fs: { downloadFile(path: string): Promise<Buffer>; uploadFile(buf: Buffer, path: string): Promise<void> }
	process: { executeCommand(cmd: string, cwd?: unknown, timeout?: number): Promise<{ result?: string; exitCode?: number }> }
} | undefined

if (!sandbox) {
	console.error(`\n❌ Sandbox ${task.sandbox_id} not found or not running`)
	process.exit(1)
}
console.log(`\n✅ Connected to sandbox ${sandbox.id}`)

// Helper to read a file, returning null if missing
async function readFile(path: string): Promise<string | null> {
	try {
		const buf = await sandbox!.fs.downloadFile(path)
		return buf.toString("utf-8")
	} catch {
		return null
	}
}

const TASK_BASE = "/home/agent/workspace/tasks"
const CODEX_HOME = "/home/agent/.codex"
const taskDir = `${TASK_BASE}/${taskId}`

// 1. Check global CODEX_HOME config.toml
console.log(`\n[1] CODEX_HOME config.toml (${CODEX_HOME}/config.toml):`)
const globalConfig = await readFile(`${CODEX_HOME}/config.toml`)
if (globalConfig) {
	console.log(globalConfig)
} else {
	console.log("   (file not found)")
}

// 2. Check workspace .codex/config.toml
console.log(`\n[2] Workspace .codex/config.toml (${taskDir}/workspace/.codex/config.toml):`)
const workspaceConfig = await readFile(`${taskDir}/workspace/.codex/config.toml`)
if (workspaceConfig) {
	console.log(workspaceConfig)
} else {
	console.log("   (file not found)")
}

// 3. Check .env file
console.log(`\n[3] .env file (${taskDir}/.env):`)
const envFile = await readFile(`${taskDir}/.env`)
if (envFile) {
	// Redact secrets
	const redacted = envFile.replace(/(Bearer\s+)\S+/g, "$1[REDACTED]")
	console.log(redacted)
} else {
	console.log("   (file not found — already deleted by run.sh)")
}

// 4. Last 50 lines of stderr.log
console.log(`\n[4] Last 50 lines of stderr.log (${taskDir}/artifacts/stderr.log):`)
const result = await sandbox.process.executeCommand(`tail -50 ${taskDir}/artifacts/stderr.log 2>/dev/null || echo "(not found)"`, undefined, 10)
console.log(result.result ?? "(no output)")

// 5. Check if codex binary knows about OTEL
console.log(`\n[5] Codex --help | grep -i otel:`)
const codexHelp = await sandbox.process.executeCommand(`codex --help 2>&1 | grep -i otel || echo "(no otel mention)"`, undefined, 10)
console.log(codexHelp.result)

// 6. Check codex version
console.log(`\n[6] Codex version:`)
const codexVersion = await sandbox.process.executeCommand(`codex --version 2>&1`, undefined, 10)
console.log(codexVersion.result)

// 7. Try reading from CODEX_HOME directly to confirm it's the right path
console.log(`\n[7] Contents of ${CODEX_HOME}/:`)
const lsResult = await sandbox.process.executeCommand(`ls -la ${CODEX_HOME}/ 2>&1`, undefined, 10)
console.log(lsResult.result)
