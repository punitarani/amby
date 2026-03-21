/** Per-task callback signing + verification (WebCrypto on Workers / Bun). */

const CALLBACK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000

const bufToHex = (buf: ArrayBuffer | Uint8Array) =>
	[...new Uint8Array(buf instanceof ArrayBuffer ? buf : new Uint8Array(buf))]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")

export async function mintCallbackSecret(): Promise<{ raw: string; hash: string }> {
	const bytes = crypto.getRandomValues(new Uint8Array(32))
	const raw = bufToHex(bytes)
	const hash = await hashSecret(raw)
	return { raw, hash }
}

export async function hashSecret(raw: string): Promise<string> {
	const encoded = new TextEncoder().encode(raw)
	const digest = await crypto.subtle.digest("SHA-256", encoded)
	return bufToHex(digest)
}

export async function verifyHmacSignature(
	rawBody: string,
	secret: string,
	timestampMs: string,
	signatureHeader: string,
): Promise<boolean> {
	const expected = await signPayload(secret, timestampMs, rawBody)
	const normalized = signatureHeader.startsWith("sha256=")
		? signatureHeader.slice("sha256=".length)
		: signatureHeader
	return timingSafeEqualHex(expected, normalized)
}

export async function signPayload(
	secret: string,
	timestampMs: string,
	rawBody: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	)
	const signed = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`${timestampMs}.${rawBody}`),
	)
	return bufToHex(new Uint8Array(signed))
}

function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length || a.length % 2 !== 0) return false
	const ab = hexToBytes(a)
	const bb = hexToBytes(b)
	if (ab.length !== bb.length) return false
	let diff = 0
	for (let i = 0; i < ab.length; i++) {
		const a = ab[i]
		const b = bb[i]
		if (a === undefined || b === undefined) return false
		diff |= a ^ b
	}
	return diff === 0
}

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2)
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

export function isTimestampValid(timestampMs: number): boolean {
	return (
		Number.isFinite(timestampMs) &&
		Math.abs(Date.now() - timestampMs) <= CALLBACK_TIMESTAMP_TOLERANCE_MS
	)
}
