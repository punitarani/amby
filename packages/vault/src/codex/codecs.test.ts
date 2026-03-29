import { describe, expect, it } from "bun:test"
import { VaultError } from "../errors"
import { parseCodexPayload, serializeCodexPayload } from "./codecs"
import type { CodexApiKeyPayload, CodexChatgptHomePayload } from "./types"

describe("codex codecs", () => {
	describe("api_key round-trip", () => {
		it("serializes and parses an API key payload", () => {
			const payload: CodexApiKeyPayload = {
				schemaVersion: 1,
				method: "api_key",
				apiKey: "sk-live-test-key-123",
			}

			const bytes = serializeCodexPayload(payload)
			const recovered = parseCodexPayload(bytes)

			expect(recovered).toEqual(payload)
			expect(recovered.method).toBe("api_key")
		})
	})

	describe("chatgpt round-trip", () => {
		it("serializes and parses a ChatGPT Home payload", () => {
			const payload: CodexChatgptHomePayload = {
				schemaVersion: 1,
				method: "chatgpt",
				archiveFormat: "tar.gz",
				archiveBase64: btoa("fake-archive-data"),
				capturedAt: "2026-03-28T00:00:00Z",
			}

			const bytes = serializeCodexPayload(payload)
			const recovered = parseCodexPayload(bytes)

			expect(recovered).toEqual(payload)
			expect(recovered.method).toBe("chatgpt")
		})
	})

	describe("validation", () => {
		it("rejects unsupported schemaVersion", () => {
			const data = new TextEncoder().encode(
				JSON.stringify({ schemaVersion: 2, method: "api_key", apiKey: "x" }),
			)
			expect(() => parseCodexPayload(data)).toThrow(VaultError)
		})

		it("rejects unknown method", () => {
			const data = new TextEncoder().encode(
				JSON.stringify({ schemaVersion: 1, method: "unknown", apiKey: "x" }),
			)
			expect(() => parseCodexPayload(data)).toThrow(VaultError)
		})

		it("rejects malformed JSON", () => {
			const data = new TextEncoder().encode("not-json")
			expect(() => parseCodexPayload(data)).toThrow(VaultError)
		})

		it("rejects non-object payload", () => {
			const data = new TextEncoder().encode('"just a string"')
			expect(() => parseCodexPayload(data)).toThrow(VaultError)
		})
	})
})
