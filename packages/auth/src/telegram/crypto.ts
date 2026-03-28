const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Extract a clean ArrayBuffer from a Uint8Array (TS 5.6+ Web Crypto compat). */
const toArrayBuffer = (data: Uint8Array): ArrayBuffer =>
	data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer

/** Constant-time string comparison to prevent timing attacks. */
export const stableCompare = (left: string, right: string) => {
	if (left.length !== right.length) {
		return false
	}

	let mismatch = 0
	for (let index = 0; index < left.length; index += 1) {
		mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
	}
	return mismatch === 0
}

export const toHex = (bytes: Uint8Array) =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")

export const hmacSha256Bytes = async (keyData: string | Uint8Array, message: string) => {
	const rawKey = typeof keyData === "string" ? textEncoder.encode(keyData) : keyData
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		toArrayBuffer(rawKey),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	)
	const signature = await crypto.subtle.sign(
		"HMAC",
		cryptoKey,
		toArrayBuffer(textEncoder.encode(message)),
	)
	return new Uint8Array(signature)
}

export const sha256Bytes = async (value: string) => {
	const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(textEncoder.encode(value)))
	return new Uint8Array(digest)
}

export const hmacSha256Hex = async (keyData: string | Uint8Array, message: string) =>
	toHex(await hmacSha256Bytes(keyData, message))

export const base64UrlToUint8Array = (value: string) => {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
	const binary = atob(padded)
	return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export const base64UrlToString = (value: string) => textDecoder.decode(base64UrlToUint8Array(value))
