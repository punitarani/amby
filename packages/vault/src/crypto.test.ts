import { describe, expect, it } from "bun:test"
import { buildAad, decrypt, encrypt, generateDek, importKek, unwrapDek, wrapDek } from "./crypto"

describe("crypto", () => {
	const aad = buildAad({ vaultId: "v1", userId: "u1", version: 1, kind: "codex_api_key" })

	describe("encrypt / decrypt round-trip", () => {
		it("recovers original plaintext", async () => {
			const dek = await generateDek()
			const plaintext = new TextEncoder().encode("super-secret-api-key-12345")
			const { ciphertext, nonce } = await encrypt({ plaintext, dek, aad })

			expect(ciphertext).not.toEqual(plaintext)
			expect(nonce.length).toBe(12)

			const recovered = await decrypt({ ciphertext, nonce, dek, aad })
			expect(recovered).toEqual(plaintext)
		})

		it("fails when AAD is tampered with", async () => {
			const dek = await generateDek()
			const plaintext = new TextEncoder().encode("secret")
			const { ciphertext, nonce } = await encrypt({ plaintext, dek, aad })

			const tamperedAad = buildAad({
				vaultId: "v1",
				userId: "u1",
				version: 2,
				kind: "codex_api_key",
			})
			await expect(decrypt({ ciphertext, nonce, dek, aad: tamperedAad })).rejects.toThrow()
		})

		it("fails when ciphertext is tampered with", async () => {
			const dek = await generateDek()
			const plaintext = new TextEncoder().encode("secret")
			const { ciphertext, nonce } = await encrypt({ plaintext, dek, aad })

			const tampered = new Uint8Array(ciphertext)
			tampered[0] = (tampered[0] ?? 0) ^ 0xff
			await expect(decrypt({ ciphertext: tampered, nonce, dek, aad })).rejects.toThrow()
		})
	})

	describe("wrapDek / unwrapDek round-trip", () => {
		it("recovers the original DEK", async () => {
			const kek = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, true, [
				"wrapKey",
				"unwrapKey",
			])
			const dek = await generateDek()
			const plaintext = new TextEncoder().encode("test-data")
			const { ciphertext, nonce } = await encrypt({ plaintext, dek, aad })

			const wrapped = await wrapDek({ dek, kek })
			const unwrapped = await unwrapDek({ wrapped, kek })
			const recovered = await decrypt({ ciphertext, nonce, dek: unwrapped, aad })

			expect(recovered).toEqual(plaintext)
		})
	})

	describe("importKek", () => {
		it("imports a valid base64-encoded 256-bit key", async () => {
			const rawKey = crypto.getRandomValues(new Uint8Array(32))
			const base64 = btoa(String.fromCharCode(...rawKey))
			const kek = await importKek(base64)

			const dek = await generateDek()
			const wrapped = await wrapDek({ dek, kek })
			expect(wrapped.length).toBeGreaterThan(0)
		})

		it("rejects an invalid key length", async () => {
			const tooShort = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(10))))
			await expect(importKek(tooShort)).rejects.toThrow()
		})
	})

	describe("buildAad", () => {
		it("produces deterministic output for same input", () => {
			const a = buildAad({ vaultId: "v1", userId: "u1", version: 1, kind: "codex_api_key" })
			const b = buildAad({ vaultId: "v1", userId: "u1", version: 1, kind: "codex_api_key" })
			expect(a).toEqual(b)
		})

		it("produces different output for different inputs", () => {
			const a = buildAad({ vaultId: "v1", userId: "u1", version: 1, kind: "codex_api_key" })
			const b = buildAad({ vaultId: "v2", userId: "u1", version: 1, kind: "codex_api_key" })
			expect(a).not.toEqual(b)
		})
	})
})
