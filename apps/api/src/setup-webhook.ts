/**
 * One-time script to register a Telegram webhook.
 *
 * Usage:
 *   bun run apps/api/src/setup-webhook.ts <webhook-url>
 *
 * Example:
 *   bun run apps/api/src/setup-webhook.ts https://example.com/telegram/webhook
 *
 * This will:
 * 1. Generate a webhook secret (or use TELEGRAM_WEBHOOK_SECRET from .env)
 * 2. Register the webhook URL with Telegram
 * 3. Print the secret — add it to your .env as TELEGRAM_WEBHOOK_SECRET
 */

import { Bot } from "grammy"

const webhookUrl = process.argv[2]

if (!webhookUrl) {
	console.error("Usage: bun run apps/api/src/setup-webhook.ts <webhook-url>")
	console.error(
		"Example: bun run apps/api/src/setup-webhook.ts https://example.com/telegram/webhook",
	)
	process.exit(1)
}

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
	console.error("TELEGRAM_BOT_TOKEN environment variable is required")
	process.exit(1)
}

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
