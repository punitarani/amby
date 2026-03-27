import { afterEach, describe, expect, it } from "bun:test"
import { verifyTelegramOidcIdToken } from "./oidc"

const textEncoder = new TextEncoder()

const toBase64Url = (value: string) =>
	btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")

const toJsonResponse = (data: unknown) =>
	new Response(JSON.stringify(data), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	})

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe("Telegram OIDC verification", () => {
	it("verifies a Telegram id_token and maps the claims", async () => {
		const keyPair = await crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			true,
			["sign", "verify"],
		)

		const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
		const nowSeconds = Math.floor(Date.now() / 1000)
		const header = {
			alg: "RS256",
			kid: "test-key",
		}
		const payload = {
			iss: "https://oauth.telegram.org",
			aud: "123456",
			exp: nowSeconds + 60,
			iat: nowSeconds,
			sub: "42",
			given_name: "Dev",
			family_name: "Tester",
			preferred_username: "devtester",
			phone_number: "+15551234567",
			photo_url: "https://t.me/i/userpic/320/devtester.jpg",
		}

		const encodedHeader = toBase64Url(JSON.stringify(header))
		const encodedPayload = toBase64Url(JSON.stringify(payload))
		const data = `${encodedHeader}.${encodedPayload}`
		const signature = await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			keyPair.privateKey,
			textEncoder.encode(data),
		)
		const token = `${data}.${toBase64Url(String.fromCharCode(...new Uint8Array(signature)))}`

		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input)
			if (url.endsWith("/.well-known/openid-configuration")) {
				return toJsonResponse({
					issuer: "https://oauth.telegram.org",
					jwks_uri: "https://oauth.telegram.org/jwks.json",
				})
			}
			if (url.endsWith("/jwks.json")) {
				return toJsonResponse({
					keys: [{ ...publicJwk, kid: "test-key" }],
				})
			}
			return new Response("not found", { status: 404 })
		}) as typeof fetch

		await expect(
			verifyTelegramOidcIdToken(token, {
				clientId: "123456",
			}),
		).resolves.toEqual({
			id: "42",
			email: "telegram-42@telegram.hiamby.invalid",
			name: "Dev Tester",
			first_name: "Dev",
			last_name: "Tester",
			username: "devtester",
			phone_number: "+15551234567",
			photo_url: "https://t.me/i/userpic/320/devtester.jpg",
			emailVerified: false,
		})
	})
})
