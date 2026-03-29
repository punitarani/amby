/** AES-256-GCM envelope encryption using Web Crypto API. */

const AES_GCM = "AES-GCM" as const
const AES_KW = "AES-KW" as const
const NONCE_BYTES = 12

// The API project includes both bun-types and @cloudflare/workers-types which
// define conflicting BufferSource types.  Using explicit casts via a helper
// keeps the call sites clean and avoids Uint8Array<ArrayBufferLike> errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buf = (v: Uint8Array): any => v

/** Generate a random 256-bit AES-GCM data-encryption key. */
export const generateDek = (): Promise<CryptoKey> =>
	crypto.subtle.generateKey({ name: AES_GCM, length: 256 }, true, ["encrypt", "decrypt"])

/** Encrypt plaintext with AES-256-GCM using the given DEK and AAD. */
export const encrypt = async (params: {
	plaintext: Uint8Array
	dek: CryptoKey
	aad: Uint8Array
}): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> => {
	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
	const encryptedBuffer = await crypto.subtle.encrypt(
		{ name: AES_GCM, iv: buf(nonce), additionalData: buf(params.aad) },
		params.dek,
		buf(params.plaintext),
	)
	return { ciphertext: new Uint8Array(encryptedBuffer), nonce }
}

/** Decrypt ciphertext (with appended GCM auth tag) using the given DEK and AAD. */
export const decrypt = async (params: {
	ciphertext: Uint8Array
	nonce: Uint8Array
	dek: CryptoKey
	aad: Uint8Array
}): Promise<Uint8Array> => {
	const decryptedBuffer = await crypto.subtle.decrypt(
		{ name: AES_GCM, iv: buf(params.nonce), additionalData: buf(params.aad) },
		params.dek,
		buf(params.ciphertext),
	)
	return new Uint8Array(decryptedBuffer)
}

/** Wrap a DEK with a key-encryption key using AES-KW. */
export const wrapDek = async (params: {
	dek: CryptoKey
	kek: CryptoKey
}): Promise<Uint8Array> => {
	const wrapped = await crypto.subtle.wrapKey("raw", params.dek, params.kek, AES_KW)
	return new Uint8Array(wrapped)
}

/** Unwrap a DEK from its wrapped form using a KEK via AES-KW. */
export const unwrapDek = (params: {
	wrapped: Uint8Array
	kek: CryptoKey
}): Promise<CryptoKey> =>
	crypto.subtle.unwrapKey(
		"raw",
		buf(params.wrapped),
		params.kek,
		AES_KW,
		AES_GCM,
		true,
		["encrypt", "decrypt"],
	)

/** Import a base64-encoded 256-bit key as an AES-KW key-encryption key. */
export const importKek = (base64Key: string): Promise<CryptoKey> => {
	const keyData = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0))
	return crypto.subtle.importKey("raw", keyData, AES_KW, false, ["wrapKey", "unwrapKey"])
}

/** Build additional authenticated data for GCM from vault context fields. */
export const buildAad = (params: {
	vaultId: string
	userId: string
	version: number
	kind: string
}): Uint8Array => new TextEncoder().encode(JSON.stringify(params))
