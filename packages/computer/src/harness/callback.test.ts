import { describe, expect, it } from "bun:test"
import { hashSecret, isTimestampValid, signPayload, verifyHmacSignature } from "./callback"

describe("hashSecret", () => {
	it("returns a deterministic 64-char hex string", async () => {
		const hash = await hashSecret("test-secret")
		expect(hash).toHaveLength(64)
		expect(hash).toMatch(/^[0-9a-f]{64}$/)
		expect(await hashSecret("test-secret")).toBe(hash)
	})

	it("produces different hashes for different inputs", async () => {
		const a = await hashSecret("secret-a")
		const b = await hashSecret("secret-b")
		expect(a).not.toBe(b)
	})
})

describe("signPayload", () => {
	it("returns a deterministic hex signature", async () => {
		const sig = await signPayload("my-secret", "1234567890", '{"test":true}')
		expect(sig).toMatch(/^[0-9a-f]{64}$/)
		expect(await signPayload("my-secret", "1234567890", '{"test":true}')).toBe(sig)
	})

	it("produces different signatures for different secrets", async () => {
		const body = '{"data":"value"}'
		const ts = "1000000"
		const sigA = await signPayload("secret-a", ts, body)
		const sigB = await signPayload("secret-b", ts, body)
		expect(sigA).not.toBe(sigB)
	})
})

describe("verifyHmacSignature", () => {
	const secret = "test-secret-key"
	const ts = "1700000000000"
	const body = '{"eventId":"abc","eventType":"task.started"}'

	it("verifies a valid round-trip signature", async () => {
		const sig = await signPayload(secret, ts, body)
		expect(await verifyHmacSignature(body, secret, ts, sig)).toBe(true)
	})

	it("verifies with sha256= prefix", async () => {
		const sig = await signPayload(secret, ts, body)
		expect(await verifyHmacSignature(body, secret, ts, `sha256=${sig}`)).toBe(true)
	})

	it("rejects wrong secret", async () => {
		const sig = await signPayload(secret, ts, body)
		expect(await verifyHmacSignature(body, "wrong-secret", ts, sig)).toBe(false)
	})

	it("rejects tampered body", async () => {
		const sig = await signPayload(secret, ts, body)
		expect(await verifyHmacSignature('{"tampered":true}', secret, ts, sig)).toBe(false)
	})
})

describe("isTimestampValid", () => {
	it("accepts current timestamp", () => {
		expect(isTimestampValid(Date.now())).toBe(true)
	})

	it("accepts timestamp 4 minutes ago", () => {
		expect(isTimestampValid(Date.now() - 4 * 60 * 1000)).toBe(true)
	})

	it("rejects timestamp 6 minutes ago", () => {
		expect(isTimestampValid(Date.now() - 6 * 60 * 1000)).toBe(false)
	})

	it("rejects NaN", () => {
		expect(isTimestampValid(NaN)).toBe(false)
	})

	it("rejects Infinity", () => {
		expect(isTimestampValid(Infinity)).toBe(false)
	})
})
