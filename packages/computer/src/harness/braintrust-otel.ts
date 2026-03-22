const BRAINTRUST_API_BASE = "https://api.braintrust.dev/v1"

export interface HarnessOtelConfig {
	masterApiKey: string
	orgName?: string
}

export interface CreatedOtelKey {
	id: string
	secret: string
}

/** List API keys by exact name. */
export async function listOtelKeysByName(
	masterApiKey: string,
	name: string,
): Promise<Array<{ id: string; name: string }>> {
	const url = `${BRAINTRUST_API_BASE}/api_key?api_key_name=${encodeURIComponent(name)}`
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${masterApiKey}` },
	})
	if (!res.ok) {
		throw new Error(`Braintrust listOtelKeysByName failed: ${res.status} ${await res.text()}`)
	}
	const body = (await res.json()) as { objects?: Array<{ id: string; name: string }> }
	return body.objects ?? []
}

/** Create a per-task Braintrust API key. Throws if a key with the same name already exists. */
export async function createHarnessOtelKey(
	config: HarnessOtelConfig,
	name: string,
): Promise<CreatedOtelKey> {
	const existing = await listOtelKeysByName(config.masterApiKey, name)
	if (existing.length > 0) {
		throw new Error(
			`Braintrust OTEL key with name "${name}" already exists (id: ${existing[0]?.id}). Refusing to create duplicate.`,
		)
	}

	const body: Record<string, string> = { name }
	if (config.orgName) body.org_name = config.orgName

	const res = await fetch(`${BRAINTRUST_API_BASE}/api_key`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.masterApiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		throw new Error(`Braintrust createHarnessOtelKey failed: ${res.status} ${await res.text()}`)
	}
	const data = (await res.json()) as { id: string; secret?: string; key?: string }
	const secret = data.secret ?? data.key
	if (!data.id || !secret) {
		throw new Error("Braintrust createHarnessOtelKey: unexpected response shape")
	}
	return { id: data.id, secret }
}

/** Delete a Braintrust API key by ID. Swallows errors (caller logs). */
export async function deleteHarnessOtelKey(masterApiKey: string, keyId: string): Promise<void> {
	try {
		await fetch(`${BRAINTRUST_API_BASE}/api_key/${keyId}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${masterApiKey}` },
		})
	} catch {
		// Intentionally swallowed — caller logs the warning
	}
}

/**
 * Build the [otel] TOML config section for codex's config.toml.
 * Uses both `exporter` (logs) and `trace_exporter` (traces) so that traces
 * reach Braintrust's OTLP traces endpoint. Codex ignores standard OTEL_* env vars.
 * See: https://developers.openai.com/codex/config-advanced#observability-and-telemetry
 */
export function buildOtelConfigSection(keySecret: string, projectId: string): string {
	const tracesEndpoint = "https://api.braintrust.dev/otel/v1/traces"
	const headersToml = `{ "Authorization" = "Bearer ${keySecret}", "x-bt-parent" = "project_id:${projectId}" }`
	const exporterToml = `{ otlp-http = { endpoint = "${tracesEndpoint}", protocol = "binary", headers = ${headersToml} } }`
	return [
		"[otel]",
		"log_user_prompt = true",
		`exporter = ${exporterToml}`,
		`trace_exporter = ${exporterToml}`,
	].join("\n")
}
