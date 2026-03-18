import type { WorkerBindings } from "@amby/env/workers"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { homeResponse } from "./home"
import { getPostHogClient } from "./posthog"
import { handleQueueBatch } from "./queue/consumer"
import type { TelegramQueueMessage } from "./telegram/utils"
import { verifySecret } from "./telegram/utils"

// Re-export Durable Object and Workflow classes so Cloudflare can discover them
export { ConversationSession } from "./durable-objects/conversation-session"
export { AgentExecutionWorkflow } from "./workflows/agent-execution"
export { SandboxProvisionWorkflow } from "./workflows/sandbox-provision"

type Env = { Bindings: WorkerBindings; Variables: { posthogDistinctId?: string } }

const app = new Hono<Env>()

app.onError(async (err, c) => {
	const status = err instanceof HTTPException ? err.status : 500

	console.error("[API] Unhandled Hono error:", err)

	const posthogKey = c.env.POSTHOG_KEY ?? ""
	if (status >= 500 && posthogKey) {
		try {
			const posthog = getPostHogClient(posthogKey, c.env.POSTHOG_HOST ?? "https://us.i.posthog.com")
			posthog.captureException(err, c.get("posthogDistinctId"), {
				framework: "hono",
				runtime: "cloudflare-worker",
				status,
				method: c.req.method,
				path: c.req.path,
				url: c.req.url,
				cf_ray: c.req.header("cf-ray") ?? null,
				content_type: c.req.header("content-type") ?? null,
				user_agent: c.req.header("user-agent") ?? null,
			})
			c.executionCtx.waitUntil(
				posthog.flush().catch((flushError) => {
					console.error("[API] Failed to flush PostHog exception:", flushError)
				}),
			)
		} catch (captureError) {
			console.error("[API] Failed to capture exception in PostHog:", captureError)
		}
	}

	if (err instanceof HTTPException) {
		return err.getResponse()
	}

	return c.json({ error: "Internal Server Error" }, 500)
})

app.get("/", (c) => c.json(homeResponse))
app.get("/health", (c) => c.json({ status: "ok" }))

// Webhook handler — verify, enqueue, return 200 immediately
app.post("/telegram/webhook", async (c) => {
	const headerSecret = c.req.header("X-Telegram-Bot-Api-Secret-Token")
	const webhookSecret = c.env.TELEGRAM_WEBHOOK_SECRET ?? ""

	if (!verifySecret(headerSecret, webhookSecret)) {
		return c.json({ error: "Unauthorized" }, 401)
	}

	const update = await c.req.json()
	const distinctId = update?.message?.from?.id
	if (distinctId) {
		c.set("posthogDistinctId", String(distinctId))
	}

	if (c.env.TELEGRAM_QUEUE) {
		await c.env.TELEGRAM_QUEUE.send({
			update,
			receivedAt: Date.now(),
		} satisfies TelegramQueueMessage)
	} else {
		console.warn("[Webhook] TELEGRAM_QUEUE binding not available — message dropped")
	}

	return c.json({ ok: true })
})

export default {
	fetch: app.fetch,

	async queue(batch: MessageBatch<TelegramQueueMessage>, env: WorkerBindings) {
		await handleQueueBatch(batch, env)
	},
}
