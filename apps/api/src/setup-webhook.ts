/**
 * One-time script to register a Telegram webhook.
 *
 * Usage:
 *   bun run apps/api/src/setup-webhook.ts [--env-file <path>]
 *
 * Examples:
 *   bun run apps/api/src/setup-webhook.ts
 *   bun run apps/api/src/setup-webhook.ts --env-file .env.production
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN   — Telegram bot token
 *   API_URL           — Base URL of the workers deployment (e.g. https://api.example.com)
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
import { Bot } from "grammy"

const args = process.argv.slice(2)
const envFileIndex = args.indexOf("--env-file")

if (envFileIndex !== -1) {
	const envFilePath = args[envFileIndex + 1]
	if (!envFilePath) {
		console.error("--env-file requires a path argument")
		process.exit(1)
	}
	const resolved = resolve(envFilePath)
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

const workersUrl = process.env.API_URL
if (!workersUrl) {
	console.error("API_URL environment variable is required")
	process.exit(1)
}

const webhookUrl = `${workersUrl.replace(/\/+$/, "")}/telegram/webhook`

// Use existing secret or generate a new one
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || crypto.randomUUID().replace(/-/g, "")

const bot = new Bot(token)

console.log(`Setting webhook to: ${webhookUrl}`)

await bot.api.setWebhook(webhookUrl, { secret_token: secret })

console.log("Webhook registered successfully!\n")

const info = await bot.api.getWebhookInfo()
console.log("Webhook info:", {
	url: info.url,
	pending_update_count: info.pending_update_count,
})

if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
	console.log(`\nAdd this to your .env:\n\n  TELEGRAM_WEBHOOK_SECRET=${secret}\n`)
}
