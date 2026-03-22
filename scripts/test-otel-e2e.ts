/**
 * End-to-end OTEL pipeline test — simulates what the supervisor does:
 * 1. Creates a Braintrust key
 * 2. Uploads a test script to the sandbox that runs codex with OTEL vars
 * 3. Executes it and checks stderr for OTEL export messages
 * 4. Checks Braintrust for any traces (after a short wait)
 * 5. Deletes the key
 *
 * Run with: doppler run -- bun run scripts/test-otel-e2e.ts
 */

import { Daytona } from "../packages/computer/node_modules/@daytonaio/sdk"
import { createHarnessOtelKey, deleteHarnessOtelKey, buildOtelEnvVars } from "../packages/computer/src/harness/braintrust-otel"
import { harnessOtelKeyName } from "../packages/computer/src/config"

const masterApiKey = process.env.BRAINTRUST_HARNESS_API_KEY ?? ""
const projectId = process.env.BRAINTRUST_HARNESS_PROJECT_ID ?? ""
const orgName = process.env.BRAINTRUST_HARNESS_ORG_NAME || undefined
const nodeEnv = process.env.NODE_ENV ?? "development"
const daytonaApiKey = process.env.DAYTONA_API_KEY ?? ""
const daytonaApiUrl = process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api"

if (!masterApiKey) { console.error("❌ BRAINTRUST_HARNESS_API_KEY not set"); process.exit(1) }
if (!projectId) { console.error("❌ BRAINTRUST_HARNESS_PROJECT_ID not set"); process.exit(1) }
if (!daytonaApiKey) { console.error("❌ DAYTONA_API_KEY not set"); process.exit(1) }

// ── Find an active sandbox ────────────────────────────────────────────────
console.log("[0] Finding active sandbox...")
const daytona = new Daytona({ apiKey: daytonaApiKey, serverUrl: daytonaApiUrl })
const sandboxes = await daytona.list()
const items = (sandboxes as { items?: unknown[] }).items ?? []
const sandbox = items.find((s) => (s as { state?: string }).state === "started") as { id: string; fs: { uploadFile(buf: Buffer, path: string): Promise<void> }; process: { executeCommand(cmd: string, cwd?: unknown, timeout?: number): Promise<{ result?: string }> } } | undefined
if (!sandbox) {
	console.error("❌ No started sandbox found. Start one first.")
	process.exit(1)
}
console.log(`   Sandbox: ${sandbox.id}`)

// ── Step 1: Create key ────────────────────────────────────────────────────
const fakeTaskId = crypto.randomUUID()
const keyName = harnessOtelKeyName(nodeEnv, sandbox.id, fakeTaskId)
console.log(`\n[1] Creating Braintrust OTEL key: ${keyName}`)
let keyId: string
let keySecret: string
try {
	const created = await createHarnessOtelKey({ masterApiKey, orgName }, keyName)
	keyId = created.id
	keySecret = created.secret
	console.log(`   ✅ Key created: ${keyId}`)
} catch (e) {
	console.error(`   ❌ Failed:`, e)
	process.exit(1)
}

// ── Step 2: Build OTEL vars and test script ───────────────────────────────
const otelVars = buildOtelEnvVars(keySecret, projectId)
console.log("\n[2] OTEL env vars:")
for (const [k, v] of Object.entries(otelVars)) {
	const display = k === "OTEL_EXPORTER_OTLP_HEADERS" ? `${v.slice(0, 50)}...` : v
	console.log(`   ${k}=${display}`)
}

// Shell script: set vars, run codex inside a git workspace, capture output
const testScript = `#!/bin/sh
export CODEX_HOME=/home/agent/.codex
${Object.entries(otelVars).map(([k, v]) => `export ${k}='${v}'`).join("\n")}

# Create a temp git workspace (codex requires a git repo)
WORK=/tmp/otel-test-work
mkdir -p $WORK
cd $WORK
git init -q
git config user.email test@test.com
git config user.name test

echo "Running codex with OTEL vars from git workspace..."
codex exec --full-auto 'print the word HELLO and stop' >stdout.log 2>stderr.log
EXIT=$?
echo "exit code: $EXIT"
echo "=== last 20 lines of stderr (may show OTEL errors) ==="
tail -20 stderr.log
echo "=== stdout ==="
cat stdout.log
`

// ── Step 3: Upload and run test script ────────────────────────────────────
console.log("\n[3] Uploading test script to sandbox...")
await sandbox.fs.uploadFile(Buffer.from(testScript), "/tmp/otel-test.sh")

console.log("   Running codex with OTEL vars (may take ~30-60s)...")
const result = await sandbox.process.executeCommand("sh /tmp/otel-test.sh", undefined, 90)
console.log("\n   --- script output ---")
console.log(result.result?.slice(0, 2000))

// Check for OTEL-related messages in output
const output = result.result ?? ""
if (output.includes("OpenTelemetry") || output.includes("otel") || output.includes("OTLP")) {
	console.log("\n   ⚠️  OTEL-related messages found in output (see above)")
} else if (output.includes("HELLO")) {
	console.log("\n   ✅ Codex ran successfully (output contains HELLO)")
} else {
	console.log("\n   ⚠️  Unexpected output — codex may have failed")
}

// ── Step 4: Wait for Braintrust to receive traces ─────────────────────────
console.log("\n[4] Waiting 10s for Braintrust to receive any traces...")
await new Promise((r) => setTimeout(r, 10000))

// Try Braintrust experiments/logs API
const btProjectRes = await fetch(
	`https://api.braintrust.dev/v1/project/${projectId}`,
	{ headers: { Authorization: `Bearer ${masterApiKey}` } },
).catch(() => null)
if (btProjectRes?.ok) {
	const proj = (await btProjectRes.json()) as { name?: string; id?: string }
	console.log(`   ✅ Braintrust project confirmed: "${proj.name ?? proj.id}"`)
	console.log("   Check the Braintrust dashboard manually for traces from this run.")
	console.log(`   Look for service_name=amby-codex in the project traces.`)
} else {
	console.log(`   Project lookup status: ${btProjectRes?.status}`)
}

// ── Step 5: Cleanup ───────────────────────────────────────────────────────
console.log("\n[5] Cleaning up key...")
await deleteHarnessOtelKey(masterApiKey, keyId)
console.log("   ✅ Key deleted")

console.log("\n✅ E2E test complete.")
console.log("\nNow restart your API and run a real task to test the full flow:")
console.log("  doppler run -- bun run dev")
console.log("  doppler run -- bun run scripts/check-task-otel.ts")
