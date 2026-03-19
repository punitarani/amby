import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { ConversationSession as ConversationSessionBase } from "./durable-objects/conversation-session"
import { homeResponse } from "./home"
import { getPostHogClient } from "./posthog"
import { handleQueueBatch } from "./queue/consumer"
import { getSentryOptions, getSentryOptionsOrFallback, setTelegramScope } from "./sentry"
import type { TelegramQueueMessage } from "./telegram/utils"
import { verifySecret } from "./telegram/utils"
import { AgentExecutionWorkflow as AgentExecutionWorkflowBase } from "./workflows/agent-execution"
import { SandboxProvisionWorkflow as SandboxProvisionWorkflowBase } from "./workflows/sandbox-provision"

// Re-export instrumented Durable Object and Workflow classes so Cloudflare can discover them
export const ConversationSession = Sentry.instrumentDurableObjectWithSentry(
	getSentryOptionsOrFallback,
	ConversationSessionBase,
)
export const AgentExecutionWorkflow = Sentry.instrumentWorkflowWithSentry(
	getSentryOptionsOrFallback,
	AgentExecutionWorkflowBase,
)
export const SandboxProvisionWorkflow = Sentry.instrumentWorkflowWithSentry(
	getSentryOptionsOrFallback,
	SandboxProvisionWorkflowBase,
)

type Env = { Bindings: WorkerBindings; Variables: { posthogDistinctId?: string } }

const app = new Hono<Env>()

app.use("*", async (c, next) => {
	const activeSpan = Sentry.getActiveSpan()
	if (activeSpan) {
		Sentry.updateSpanName(Sentry.getRootSpan(activeSpan), `${c.req.method} ${c.req.path}`)
	}
	await next()
})

app.onError(async (err, c) => {
	const status = err instanceof HTTPException ? err.status : 500

	const activeSpan = Sentry.getActiveSpan()
	if (activeSpan) {
		Sentry.setHttpStatus(activeSpan, status)
	}
	if (!(err instanceof HTTPException) || status >= 500) {
		Sentry.captureException(err)
	}

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
	const message = update?.message
	const distinctId = message?.from?.id
	setTelegramScope({
		component: "telegram.webhook",
		chatId: message?.chat?.id,
		from: message?.from,
		attributes: {
			http_method: c.req.method,
			http_path: c.req.path,
			telegram_update_id: update?.update_id,
			telegram_message_id: message?.message_id,
			has_text: Boolean(message?.text),
		},
	})

	if (distinctId) {
		c.set("posthogDistinctId", String(distinctId))
	}

	const telegramQueue = c.env.TELEGRAM_QUEUE
	if (telegramQueue) {
		await Sentry.startSpan({ op: "queue.publish", name: "telegram-inbound" }, async () => {
			await telegramQueue.send({
				update,
				receivedAt: Date.now(),
			} satisfies TelegramQueueMessage)
		})
		Sentry.logger.info("Telegram update accepted", {
			telegram_update_id: update?.update_id,
			telegram_message_id: message?.message_id,
			telegram_chat_id: message?.chat?.id,
			telegram_from_id: message?.from?.id,
			has_text: Boolean(message?.text),
		})
	} else {
		console.warn("[Webhook] TELEGRAM_QUEUE binding not available — message dropped")
	}

	return c.json({ ok: true })
})

const worker: ExportedHandler<WorkerBindings, TelegramQueueMessage> = {
	fetch: app.fetch,

	async queue(batch: MessageBatch<TelegramQueueMessage>, env: WorkerBindings) {
		await handleQueueBatch(batch, env)
	},
}

export default Sentry.withSentry<WorkerBindings, TelegramQueueMessage>(getSentryOptions, worker)
