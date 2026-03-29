import { VaultError } from "../errors"
import type { CodexCredentialPayload } from "./types"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const VALID_METHODS = new Set(["api_key", "chatgpt"])

/** Serialize a Codex credential payload to a Uint8Array for encryption. */
export const serializeCodexPayload = (payload: CodexCredentialPayload): Uint8Array =>
	encoder.encode(JSON.stringify(payload))

/** Parse a Uint8Array back into a typed Codex credential payload. */
export const parseCodexPayload = (data: Uint8Array): CodexCredentialPayload => {
	const text = decoder.decode(data)

	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch (cause) {
		throw new VaultError({ message: "Invalid Codex credential payload: malformed JSON", cause })
	}

	if (typeof parsed !== "object" || parsed === null) {
		throw new VaultError({ message: "Invalid Codex credential payload: not an object" })
	}

	const record = parsed as Record<string, unknown>

	if (record.schemaVersion !== 1) {
		throw new VaultError({
			message: `Invalid Codex credential payload: unsupported schemaVersion ${String(record.schemaVersion)}`,
		})
	}

	if (typeof record.method !== "string" || !VALID_METHODS.has(record.method)) {
		throw new VaultError({
			message: `Invalid Codex credential payload: unknown method "${String(record.method)}"`,
		})
	}

	return parsed as CodexCredentialPayload
}
