/**
 * Directly tests whether Braintrust accepts OTLP logs and traces.
 * Sends minimal OTLP JSON payloads to both endpoints.
 * Run with: doppler run -- bun run scripts/test-braintrust-otel-endpoint.ts
 */

const masterApiKey = process.env.BRAINTRUST_HARNESS_API_KEY ?? ""
const projectId = process.env.BRAINTRUST_HARNESS_PROJECT_ID ?? ""

if (!masterApiKey || !projectId) {
	console.error("❌ BRAINTRUST_HARNESS_API_KEY and BRAINTRUST_HARNESS_PROJECT_ID required")
	process.exit(1)
}

const headers = {
	"Content-Type": "application/json",
	Authorization: `Bearer ${masterApiKey}`,
	"x-bt-parent": `project_id:${projectId}`,
}

const now = Date.now()
const nowNs = BigInt(now) * 1_000_000n

// Minimal OTLP JSON log payload
const logPayload = {
	resourceLogs: [
		{
			resource: {
				attributes: [
					{ key: "service.name", value: { stringValue: "amby-codex-test" } },
					{ key: "app.version", value: { stringValue: "0.116.0" } },
				],
			},
			scopeLogs: [
				{
					scope: { name: "codex" },
					logRecords: [
						{
							timeUnixNano: nowNs.toString(),
							severityNumber: 9,
							severityText: "INFO",
							body: { stringValue: "codex.conversation_starts" },
							attributes: [
								{ key: "event.name", value: { stringValue: "codex.conversation_starts" } },
								{ key: "model", value: { stringValue: "gpt-4o" } },
								{ key: "test", value: { boolValue: true } },
							],
						},
					],
				},
			],
		},
	],
}

// Minimal OTLP JSON trace payload
const tracePayload = {
	resourceSpans: [
		{
			resource: {
				attributes: [
					{ key: "service.name", value: { stringValue: "amby-codex-test" } },
					{ key: "app.version", value: { stringValue: "0.116.0" } },
				],
			},
			scopeSpans: [
				{
					scope: { name: "codex" },
					spans: [
						{
							traceId: "5b8efff798038103d269b633813fc60c",
							spanId: "eee19b7ec3c1b174",
							name: "codex.conversation_starts",
							kind: 1,
							startTimeUnixNano: nowNs.toString(),
							endTimeUnixNano: (nowNs + 1_000_000n).toString(),
							attributes: [
								{ key: "model", value: { stringValue: "gpt-4o" } },
								{ key: "test", value: { boolValue: true } },
							],
						},
					],
				},
			],
		},
	],
}

async function testEndpoint(name: string, url: string, payload: object) {
	console.log(`\n[${name}] POST ${url}`)
	try {
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		})
		const text = await res.text()
		console.log(`   Status: ${res.status} ${res.statusText}`)
		console.log(`   Body: ${text.slice(0, 500)}`)
		return res.ok
	} catch (e) {
		console.log(`   Error: ${e}`)
		return false
	}
}

// Test both endpoints
const logOk = await testEndpoint("OTLP Logs  ", "https://api.braintrust.dev/otel/v1/logs", logPayload)
const traceOk = await testEndpoint("OTLP Traces", "https://api.braintrust.dev/otel/v1/traces", tracePayload)

console.log(`\n── Results ──`)
console.log(`OTLP Logs endpoint:   ${logOk ? "✅ accepted" : "❌ rejected"}`)
console.log(`OTLP Traces endpoint: ${traceOk ? "✅ accepted" : "❌ rejected"}`)

if (traceOk && !logOk) {
	console.log(`\n⚠️  Braintrust only accepts traces, not logs.`)
	console.log(`   Codex sends OTEL logs — they won't appear in Braintrust.`)
} else if (logOk) {
	console.log(`\n✅ Braintrust accepted logs. Check dashboard for test events from service 'amby-codex-test'.`)
}
