import { createHash, randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const AUTH_DIR = join(homedir(), ".amby")
const TOKEN_FILE = join(AUTH_DIR, "openai-tokens.json")
const CALLBACK_PORT = 1455

interface CodexTokens {
	access: string
	refresh: string
	expires: number
	accountId: string
}

function generatePKCE() {
	const verifier = randomBytes(32).toString("base64url")
	const challenge = createHash("sha256").update(verifier).digest("base64url")
	return { verifier, challenge }
}

export async function loadTokens(): Promise<CodexTokens | null> {
	try {
		const data = await readFile(TOKEN_FILE, "utf-8")
		return JSON.parse(data) as CodexTokens
	} catch {
		return null
	}
}

async function saveTokens(tokens: CodexTokens): Promise<void> {
	await mkdir(AUTH_DIR, { recursive: true })
	await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2))
}

export async function getValidAccessToken(): Promise<string | null> {
	const tokens = await loadTokens()
	if (!tokens) return null

	if (Date.now() < tokens.expires) return tokens.access

	// Refresh
	try {
		const res = await fetch("https://auth.openai.com/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "refresh_token",
				refresh_token: tokens.refresh,
				client_id: "app-svc-codex",
			}),
		})
		if (!res.ok) return null
		const data = (await res.json()) as {
			access_token: string
			refresh_token?: string
			expires_in: number
		}
		const updated: CodexTokens = {
			access: data.access_token,
			refresh: data.refresh_token ?? tokens.refresh,
			expires: Date.now() + data.expires_in * 1000,
			accountId: tokens.accountId,
		}
		await saveTokens(updated)
		return updated.access
	} catch {
		return null
	}
}

export async function startCodexOAuth(): Promise<CodexTokens> {
	const { verifier, challenge } = generatePKCE()
	const state = randomBytes(16).toString("hex")

	const authUrl = new URL("https://auth.openai.com/oauth/authorize")
	authUrl.searchParams.set("client_id", "app-svc-codex")
	authUrl.searchParams.set("response_type", "code")
	authUrl.searchParams.set("redirect_uri", `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`)
	authUrl.searchParams.set("code_challenge", challenge)
	authUrl.searchParams.set("code_challenge_method", "S256")
	authUrl.searchParams.set("state", state)
	authUrl.searchParams.set("scope", "openid profile email")

	console.log("\nOpen this URL in your browser to authenticate with OpenAI:")
	console.log(authUrl.toString())

	const code = await captureCallback(state)

	const res = await fetch("https://auth.openai.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			code,
			redirect_uri: `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`,
			client_id: "app-svc-codex",
			code_verifier: verifier,
		}),
	})

	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Token exchange failed: ${text}`)
	}

	const data = (await res.json()) as {
		access_token: string
		refresh_token: string
		expires_in: number
		id_token?: string
	}

	// Extract accountId from access token (JWT)
	const accountId = (() => {
		try {
			const parts = data.access_token.split(".")
			const segment = parts[1]
			if (!segment) return "unknown"
			const payload = JSON.parse(Buffer.from(segment, "base64").toString())
			return (payload.sub ?? payload.account_id ?? "unknown") as string
		} catch {
			return "unknown"
		}
	})()

	const tokens: CodexTokens = {
		access: data.access_token,
		refresh: data.refresh_token,
		expires: Date.now() + data.expires_in * 1000,
		accountId,
	}

	await saveTokens(tokens)
	return tokens
}

function captureCallback(expectedState: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = Bun.serve({
			port: CALLBACK_PORT,
			fetch(req) {
				const url = new URL(req.url)
				if (url.pathname !== "/auth/callback") {
					return new Response("Not found", { status: 404 })
				}
				const code = url.searchParams.get("code")
				const returnedState = url.searchParams.get("state")

				if (returnedState !== expectedState) {
					reject(new Error("State mismatch"))
					return new Response("State mismatch", { status: 400 })
				}
				if (!code) {
					reject(new Error("No code in callback"))
					return new Response("No code", { status: 400 })
				}

				resolve(code)
				setTimeout(() => server.stop(), 100)
				return new Response(
					"<html><body><h1>Authenticated!</h1><p>You can close this tab.</p></body></html>",
					{ headers: { "Content-Type": "text/html" } },
				)
			},
		})

		// Timeout after 5 minutes
		setTimeout(() => {
			server.stop()
			reject(new Error("OAuth callback timed out"))
		}, 300_000)
	})
}
