/**
 * One-time script to register a Telegram webhook.
 *
 * Usage:
 *   bun run apps/api/src/setup-webhook.ts [--env-file <path>] [webhookUrl]
 *
 * Examples:
 *   bun run apps/api/src/setup-webhook.ts
 *   bun run apps/api/src/setup-webhook.ts --env-file .env.production
 *   bun run apps/api/src/setup-webhook.ts https://example.ngrok-free.app/telegram/webhook
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN — Telegram bot token
 *   API_URL — Base URL of the workers deployment (e.g. https://api.example.com), unless webhookUrl is passed as the first positional argument
 *
 * Optional env vars:
 *   TELEGRAM_WEBHOOK_SECRET — Reuse an existing secret (otherwise one is generated)
 *
 * This will:
 * 1. Load environment variables from the specified env file (if provided)
 * 2. Generate a webhook secret (or use TELEGRAM_WEBHOOK_SECRET from env)
 * 3. Register the webhook URL with Telegram
 * 4. Print the secret — add it to your .env as TELEGRAM_WEBHOOK_SECRET
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const args = process.argv.slice(2)

/** Strip `--env-file <path>` from args so positional URL is still argv[0]. */
function parseArgs(): { envFile: string | undefined; positional: string[] } {
	let envFile: string | undefined
	const positional: string[] = []
	for (let i = 0; i < args.length; i++) {
		const a = args[i]
		if (a === "--env-file") {
			envFile = args[i + 1]
			i++
			continue
		}
		if (a !== undefined) positional.push(a)
	}
	return { envFile, positional }
}

async function telegramBot<T>(
	token: string,
	method: string,
	body?: Record<string, unknown>,
): Promise<T> {
	const url = `https://api.telegram.org/bot${token}/${method}`
	const res = await fetch(url, {
		method: body ? "POST" : "GET",
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	})
	const data = (await res.json()) as {
		ok: boolean
		description?: string
		result: T
	}
	if (!data.ok) {
		throw new Error(data.description ?? `Telegram API ${method} failed`)
	}
	return data.result
}

const { envFile, positional } = parseArgs()

if (envFile) {
	const resolved = resolve(envFile)
	const content = readFileSync(resolved, "utf-8")
	for (const line of content.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#")) continue
		const eqIndex = trimmed.indexOf("=")
		if (eqIndex === -1) continue
		const key = trimmed.slice(0, eqIndex).trim()
		const value = trimmed
			.slice(eqIndex + 1)
			.trim()
			.replace(/^["']|["']$/g, "")
		process.env[key] = value
	}
}

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
	console.error("TELEGRAM_BOT_TOKEN environment variable is required")
	process.exit(1)
}

const explicitUrl = positional[0]
let webhookUrl: string
if (explicitUrl?.startsWith("http://") || explicitUrl?.startsWith("https://")) {
	webhookUrl = explicitUrl
} else {
	const workersUrl = process.env.API_URL
	if (!workersUrl) {
		console.error(
			"Set API_URL to your deployment base URL, or pass the full webhook URL as the first argument.",
		)
		process.exit(1)
	}
	webhookUrl = `${workersUrl.replace(/\/+$/, "")}/telegram/webhook`
}

const secret = process.env.TELEGRAM_WEBHOOK_SECRET || crypto.randomUUID().replace(/-/g, "")

console.log(`Setting webhook to: ${webhookUrl}`)

await telegramBot<true>(token, "setWebhook", {
	url: webhookUrl,
	secret_token: secret,
})

console.log("Webhook registered successfully!\n")

const info = await telegramBot<{
	url?: string
	pending_update_count?: number
}>(token, "getWebhookInfo")

console.log("Webhook info:", {
	url: info.url,
	pending_update_count: info.pending_update_count,
})

if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
	console.log(`\nAdd this to your .env:\n\n  TELEGRAM_WEBHOOK_SECRET=${secret}\n`)
}
