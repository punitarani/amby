import { AuthService, getAuthTrustedOrigins } from "@amby/auth"
import { type ChatSdkDeps, getOrCreateChat, type TelegramQueueMessage } from "@amby/channels"
import type { WorkerBindings } from "@amby/env/workers"
import {
	buildSafeComposioRedirectUrl,
	ConnectorsService,
	getExpiredConnectedAccountId,
	getWebhookType,
	normalizeWebhookPayload,
	WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
} from "@amby/plugins/integrations"
import * as Sentry from "@sentry/cloudflare"
import { Effect, Either } from "effect"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { handleExpiredConnectedAccount } from "./composio/expired-account"
import { ConversationSession as ConversationSessionBase } from "./durable-objects/conversation-session"
import { handleScheduledReconciliation } from "./handlers/reconciliation"
import { handleTaskEventPost } from "./handlers/task-events"
import { getHomeResponse } from "./home"
import { getPostHogClient } from "./posthog"
import { handleQueueBatch } from "./queue/consumer"
import { makeAgentRuntimeForConsumer, makeRuntimeForConsumer } from "./queue/runtime"
import { getSentryOptions, getSentryOptionsOrFallback, setTelegramScope } from "./sentry"
import { AgentExecutionWorkflow as AgentExecutionWorkflowBase } from "./workflows/agent-execution"
import { SandboxProvisionWorkflow as SandboxProvisionWorkflowBase } from "./workflows/sandbox-provision"
import { VolumeProvisionWorkflow as VolumeProvisionWorkflowBase } from "./workflows/volume-provision"

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
export const VolumeProvisionWorkflow = Sentry.instrumentWorkflowWithSentry(
	getSentryOptionsOrFallback,
	VolumeProvisionWorkflowBase,
)

type Env = { Bindings: WorkerBindings; Variables: { posthogDistinctId?: string } }

const app = new Hono<Env>()

const resolveAuthCorsOrigin = (origin: string | undefined, env: WorkerBindings) => {
	const allowedOrigins = new Set(
		getAuthTrustedOrigins({
			NODE_ENV: env.NODE_ENV ?? "production",
			APP_URL: env.APP_URL ?? "https://hiamby.com",
			API_URL: env.API_URL ?? "https://api.hiamby.com",
			BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? env.API_URL ?? "https://api.hiamby.com",
		}),
	)
	if (!origin) {
		return env.APP_URL ?? "https://hiamby.com"
	}
	return allowedOrigins.has(origin) ? origin : ""
}

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

app.use("/api/auth/*", async (c, next) =>
	cors({
		origin: (origin) => resolveAuthCorsOrigin(origin, c.env),
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		exposeHeaders: ["Set-Cookie"],
		credentials: true,
	})(c, next),
)

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
	const runtime = makeRuntimeForConsumer(c.env)
	try {
		const auth = await runtime.runPromise(
			Effect.gen(function* () {
				return yield* AuthService
			}),
		)
		return auth.handler(c.req.raw)
	} finally {
		await runtime.dispose()
	}
})

app.get("/", (c) => c.json(getHomeResponse()))
app.get("/health", (c) => c.json({ status: "ok" }))

// White-label connect link — resolves UUID to the underlying Composio auth URL
app.get("/link/:id", async (c) => {
	const rt = makeRuntimeForConsumer(c.env)
	try {
		const result = await rt.runPromise(
			Effect.gen(function* () {
				const connectors = yield* ConnectorsService
				return yield* connectors.resolveConnectLink(c.req.param("id"))
			}).pipe(Effect.either),
		)
		const url = Either.isRight(result) ? result.right : undefined
		return url ? c.redirect(url, 302) : c.notFound()
	} finally {
		await rt.dispose()
	}
})

// OAuth callback proxy — OAuth providers redirect here; we 302 to Composio so the browser shows your API domain (not backend.composio.dev)
app.get("/composio/redirect", (c) => {
	return c.redirect(buildSafeComposioRedirectUrl(c.req.url), 302)
})

// Chat SDK dependency injection — bridges @amby/channels to apps/api Sentry and runtime
const chatSdkDeps: ChatSdkDeps = {
	makeRuntimeForConsumer,
	setTelegramScope,
	captureException: (err) => Sentry.captureException(err),
	captureCommandError: (command, chatId, err) =>
		console.error(`[ChatSDK] Command ${command} failed for chat ${chatId}:`, err),
}

// Webhook handler — Chat SDK handles secret verification, parsing, and routing via waitUntil
app.post("/telegram/webhook", async (c) => {
	const { chat } = getOrCreateChat(c.env, chatSdkDeps)
	return chat.webhooks.telegram(c.req.raw, {
		waitUntil: (task) => c.executionCtx.waitUntil(task),
	})
})

app.post("/internal/task-events", async (c) => {
	const rt = makeAgentRuntimeForConsumer(c.env)
	try {
		return await rt.runPromise(handleTaskEventPost(c.req.raw))
	} finally {
		await rt.dispose()
	}
})

app.post("/composio/webhook", async (c) => {
	if (!c.env.COMPOSIO_API_KEY || !c.env.COMPOSIO_WEBHOOK_SECRET) {
		return c.json({ error: "Composio webhook not configured" }, 503)
	}

	const signature = c.req.header("webhook-signature")
	const webhookId = c.req.header("webhook-id")
	const webhookTimestamp = c.req.header("webhook-timestamp")

	if (!signature || !webhookId || !webhookTimestamp) {
		return c.json({ error: "Unauthorized" }, 401)
	}

	const timestampAge = Math.abs(Math.floor(Date.now() / 1000) - Number(webhookTimestamp))
	if (!Number.isFinite(timestampAge) || timestampAge > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
		return c.json({ error: "Unauthorized" }, 401)
	}

	const payload = await c.req.text()
	const runtime = makeRuntimeForConsumer(c.env)

	try {
		const verification = await runtime.runPromise(
			Effect.gen(function* () {
				const connectors = yield* ConnectorsService
				return yield* connectors.verifyWebhook(payload, {
					signature,
					webhookId,
					webhookTimestamp,
				})
			}).pipe(Effect.either),
		)

		if (Either.isLeft(verification)) {
			return c.json({ error: "Unauthorized" }, 401)
		}

		const verifiedPayload =
			normalizeWebhookPayload(verification.right.rawPayload) ??
			normalizeWebhookPayload(verification.right.payload)
		const eventType = getWebhookType(verifiedPayload)

		if (eventType !== "composio.connected_account.expired") {
			return c.json({ status: "ignored", eventType: eventType ?? null }, 202)
		}

		const connectedAccountId = getExpiredConnectedAccountId(verifiedPayload)
		if (!connectedAccountId) {
			console.error("[Composio] Expired webhook missing connected account id:", verifiedPayload)
			return c.json({ status: "ignored", reason: "missing_connected_account_id" }, 202)
		}

		const result = await runtime.runPromise(handleExpiredConnectedAccount(connectedAccountId))

		return c.json(result)
	} finally {
		await runtime.dispose()
	}
})

const worker: ExportedHandler<WorkerBindings, TelegramQueueMessage> = {
	fetch: app.fetch,

	async queue(batch: MessageBatch<TelegramQueueMessage>, env: WorkerBindings) {
		await handleQueueBatch(batch, env)
	},

	async scheduled(_controller: ScheduledController, env: WorkerBindings, _ctx: ExecutionContext) {
		await handleScheduledReconciliation(env)
	},
}

// `withSentry` wraps the full `ExportedHandler` (fetch + queue + scheduled); cron is preserved.
export default Sentry.withSentry<WorkerBindings, TelegramQueueMessage>(getSentryOptions, worker)
