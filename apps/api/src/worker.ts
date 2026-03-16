import type { WorkerBindings } from "@amby/env/workers"
import { Hono } from "hono"
import { handleQueueBatch } from "./queue/consumer"
import type { TelegramQueueMessage } from "./telegram/utils"
import { verifySecret } from "./telegram/utils"

// Re-export Durable Object and Workflow classes so Cloudflare can discover them
export { ConversationSession } from "./durable-objects/conversation-session"
export { AgentExecutionWorkflow } from "./workflows/agent-execution"

type Env = { Bindings: WorkerBindings }

const app = new Hono<Env>()

app.get("/health", (c) => c.json({ status: "ok" }))

// Webhook handler — verify, enqueue, return 200 immediately
app.post("/telegram/webhook", async (c) => {
	const headerSecret = c.req.header("X-Telegram-Bot-Api-Secret-Token")
	const webhookSecret = c.env.TELEGRAM_WEBHOOK_SECRET ?? ""

	if (!verifySecret(headerSecret, webhookSecret)) {
		return c.json({ error: "Unauthorized" }, 401)
	}

	const update = await c.req.json()

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
