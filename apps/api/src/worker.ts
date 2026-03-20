import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { ConversationSession as ConversationSessionBase } from "./durable-objects/conversation-session"
import { getHomeResponse } from "./home"
import { getPostHogClient } from "./posthog"
import { handleQueueBatch } from "./queue/consumer"
import { getSentryOptions, getSentryOptionsOrFallback } from "./sentry"
import { getOrCreateChat } from "./telegram/chat-sdk"
import type { TelegramQueueMessage } from "./telegram/utils"
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

app.get("/", (c) => c.json(getHomeResponse()))
app.get("/health", (c) => c.json({ status: "ok" }))

// Webhook handler — Chat SDK handles secret verification, parsing, and routing via waitUntil
app.post("/telegram/webhook", async (c) => {
	const { chat } = getOrCreateChat(c.env)
	return chat.webhooks.telegram(c.req.raw, {
		waitUntil: (task) => c.executionCtx.waitUntil(task),
	})
})

const worker: ExportedHandler<WorkerBindings, TelegramQueueMessage> = {
	fetch: app.fetch,

	async queue(batch: MessageBatch<TelegramQueueMessage>, env: WorkerBindings) {
		await handleQueueBatch(batch, env)
	},
}

export default Sentry.withSentry<WorkerBindings, TelegramQueueMessage>(getSentryOptions, worker)
