/** Per-task callback secret + HMAC verification (WebCrypto — Workers + Bun). */

export const CALLBACK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000

function bufToHex(bytes: Uint8Array): string {
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false
	let out = 0
	for (let i = 0; i < a.length; i++) {
		out |= a.charCodeAt(i) ^ b.charCodeAt(i)
	}
	return out === 0
}

export async function mintCallbackSecret(): Promise<{ raw: string; hash: string }> {
	const bytes = crypto.getRandomValues(new Uint8Array(32))
	const raw = bufToHex(bytes)
	const hash = await hashSecret(raw)
	return { raw, hash }
}

export async function hashSecret(raw: string): Promise<string> {
	const encoded = new TextEncoder().encode(raw)
	const digest = await crypto.subtle.digest("SHA-256", encoded)
	return bufToHex(new Uint8Array(digest))
}

export async function verifyHmac(
	rawBody: string,
	secret: string,
	signatureHeader: string,
): Promise<boolean> {
	const expectedPrefix = "sha256="
	if (!signatureHeader.startsWith(expectedPrefix)) return false
	const providedHex = signatureHeader.slice(expectedPrefix.length)
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	)
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
	const computedHex = bufToHex(new Uint8Array(sig))
	return timingSafeEqual(computedHex.toLowerCase(), providedHex.toLowerCase())
}

export function isTimestampValid(timestampMs: number): boolean {
	return (
		Number.isFinite(timestampMs) &&
		Math.abs(Date.now() - timestampMs) <= CALLBACK_TIMESTAMP_TOLERANCE_MS
	)
}
