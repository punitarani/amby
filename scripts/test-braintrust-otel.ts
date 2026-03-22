/**
 * Step-by-step test script for Braintrust OTEL key management.
 * Run with: bun run scripts/test-braintrust-otel.ts
 *
 * Requires BRAINTRUST_HARNESS_API_KEY to be set (via Doppler or .env).
 */

const BRAINTRUST_API_BASE = "https://api.braintrust.dev/v1"

const masterApiKey = process.env.BRAINTRUST_HARNESS_API_KEY ?? ""
const projectId = process.env.BRAINTRUST_HARNESS_PROJECT_ID ?? ""
const orgName = process.env.BRAINTRUST_HARNESS_ORG_NAME || undefined

if (!masterApiKey) {
	console.error("❌ BRAINTRUST_HARNESS_API_KEY is not set. Aborting.")
	process.exit(1)
}

console.log(`✅ BRAINTRUST_HARNESS_API_KEY is set (last 4: ...${masterApiKey.slice(-4)})`)
console.log(`   PROJECT_ID: ${projectId || "(empty)"}`)
console.log(`   ORG_NAME:   ${orgName ?? "(empty — using default org)"}`)
console.log()

// ── Step 1: List keys ─────────────────────────────────────────────────────

const testKeyName = `amby-dev-codex-test1234-test5678`
console.log(`[1] Listing existing keys named "${testKeyName}"...`)
const listRes = await fetch(
	`${BRAINTRUST_API_BASE}/api_key?api_key_name=${encodeURIComponent(testKeyName)}`,
	{ headers: { Authorization: `Bearer ${masterApiKey}` } },
)
if (!listRes.ok) {
	console.error(`❌ List failed: ${listRes.status} ${await listRes.text()}`)
	process.exit(1)
}
const listBody = (await listRes.json()) as { objects?: Array<{ id: string; name: string }> }
console.log(`   Found ${listBody.objects?.length ?? 0} existing key(s) with that name`)

// ── Step 2: Create key ────────────────────────────────────────────────────

console.log(`\n[2] Creating key "${testKeyName}"...`)
const createBody: Record<string, string> = { name: testKeyName }
if (orgName) createBody.org_name = orgName

const createRes = await fetch(`${BRAINTRUST_API_BASE}/api_key`, {
	method: "POST",
	headers: {
		Authorization: `Bearer ${masterApiKey}`,
		"Content-Type": "application/json",
	},
	body: JSON.stringify(createBody),
})
if (!createRes.ok) {
	const text = await createRes.text()
	console.error(`❌ Create failed: ${createRes.status} ${text}`)
	process.exit(1)
}
const created = (await createRes.json()) as { id: string; secret?: string; key?: string }
const secret = created.secret ?? created.key
console.log(`   ✅ Created key id: ${created.id}`)
console.log(`   Secret (last 6): ...${secret?.slice(-6) ?? "(missing!)"}`)
if (!secret) {
	console.error("❌ API response missing 'secret' and 'key' fields. Response:", created)
	process.exit(1)
}

// ── Step 3: Show what OTEL env vars would look like ───────────────────────

console.log(`\n[3] OTEL env vars that would be injected into sandbox .env:`)
console.log(`   OTEL_EXPORTER_OTLP_ENDPOINT=https://api.braintrust.dev/otel`)
console.log(
	`   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer ${secret.slice(0, 6)}...,x-bt-parent=project_id:${projectId || "(EMPTY — set BRAINTRUST_HARNESS_PROJECT_ID!)"}`,
)
console.log(`   OTEL_SERVICE_NAME=amby-codex`)

if (!projectId) {
	console.warn(
		"\n⚠️  BRAINTRUST_HARNESS_PROJECT_ID is empty! The x-bt-parent header will be malformed.",
	)
	console.warn("   Set it to your Braintrust project ID (found in project Settings URL).")
}

// ── Step 4: Verify key appears in list ───────────────────────────────────

console.log(`\n[4] Verifying key appears in list...`)
const verifyRes = await fetch(
	`${BRAINTRUST_API_BASE}/api_key?api_key_name=${encodeURIComponent(testKeyName)}`,
	{ headers: { Authorization: `Bearer ${masterApiKey}` } },
)
const verifyBody = (await verifyRes.json()) as { objects?: Array<{ id: string; name: string }> }
const found = verifyBody.objects?.find((k) => k.id === created.id)
console.log(found ? `   ✅ Key confirmed in list` : `   ❌ Key NOT found in list after creation`)

// ── Step 5: Delete key ────────────────────────────────────────────────────

console.log(`\n[5] Deleting key ${created.id}...`)
const delRes = await fetch(`${BRAINTRUST_API_BASE}/api_key/${created.id}`, {
	method: "DELETE",
	headers: { Authorization: `Bearer ${masterApiKey}` },
})
if (!delRes.ok) {
	console.error(`❌ Delete failed: ${delRes.status} ${await delRes.text()}`)
} else {
	console.log(`   ✅ Deleted successfully (status: ${delRes.status})`)
}

// ── Step 6: Verify deletion ───────────────────────────────────────────────

console.log(`\n[6] Verifying key is gone...`)
const finalRes = await fetch(
	`${BRAINTRUST_API_BASE}/api_key?api_key_name=${encodeURIComponent(testKeyName)}`,
	{ headers: { Authorization: `Bearer ${masterApiKey}` } },
)
const finalBody = (await finalRes.json()) as { objects?: Array<{ id: string; name: string }> }
const stillExists = finalBody.objects?.find((k) => k.id === created.id)
console.log(stillExists ? `   ❌ Key still exists after deletion!` : `   ✅ Key successfully deleted`)

console.log("\n🎉 Braintrust API test complete.")
