import { ConnectorsService, getIntegrationExpiredMessage } from "@amby/connectors"
import { and, DbService, eq, inArray, schema } from "@amby/db"
import type { WorkerBindings } from "@amby/env/workers"
import * as Sentry from "@sentry/cloudflare"
import { Effect, Either } from "effect"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { ConversationSession as ConversationSessionBase } from "./durable-objects/conversation-session"
import { getHomeResponse } from "./home"
import { getPostHogClient } from "./posthog"
import { handleQueueBatch } from "./queue/consumer"
import { makeRuntimeForConsumer } from "./queue/runtime"
import { getSentryOptions, getSentryOptionsOrFallback } from "./sentry"
import { TelegramSender } from "./telegram"
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

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined

const pickString = (...values: unknown[]): string | undefined =>
	values.find((value): value is string => typeof value === "string" && value.trim().length > 0)

const normalizeWebhookPayload = (value: unknown): Record<string, unknown> | undefined => {
	if (typeof value === "string") {
		try {
			return asRecord(JSON.parse(value))
		} catch {
			return undefined
		}
	}

	return asRecord(value)
}

const getWebhookType = (payload: unknown): string | undefined => {
	const object = normalizeWebhookPayload(payload)
	return pickString(object?.type, asRecord(object?.event)?.type)
}

const getExpiredConnectedAccountId = (payload: unknown): string | undefined => {
	const object = normalizeWebhookPayload(payload)
	const data = asRecord(object?.data)
	const connectedAccount = asRecord(
		data?.connectedAccount ??
			data?.connected_account ??
			object?.connectedAccount ??
			object?.connected_account,
	)

	return pickString(
		data?.connectedAccountId,
		data?.connected_account_id,
		data?.id,
		object?.connectedAccountId,
		object?.connected_account_id,
		connectedAccount?.id,
	)
}

const getTelegramChatId = (metadata: unknown): number | undefined => {
	const object = asRecord(metadata)
	if (!object) return undefined

	const value = object.chatId
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}

	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10)
		return Number.isFinite(parsed) ? parsed : undefined
	}

	return undefined
}

const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300

const handleExpiredConnectedAccount = (connectedAccountId: string) =>
	Effect.gen(function* () {
		const connectors = yield* ConnectorsService
		const sender = yield* TelegramSender
		const { query } = yield* DbService
		const expiredAccount = yield* connectors.getConnectedAccountById(connectedAccountId).pipe(
			Effect.catchAll((error) =>
				Effect.sync(() => {
					console.error(
						`[Composio] Failed to resolve connected account ${connectedAccountId}:`,
						error,
					)
					return undefined
				}),
			),
		)

		const cleared = yield* connectors.clearPreferredAccountByConnectedAccountId(connectedAccountId)
		const affectedIntegrations = new Map<string, (typeof cleared)[number]>()

		if (expiredAccount) {
			affectedIntegrations.set(`${expiredAccount.userId}:${expiredAccount.toolkit}`, {
				userId: expiredAccount.userId,
				toolkit: expiredAccount.toolkit,
			})
		}

		for (const row of cleared) {
			affectedIntegrations.set(`${row.userId}:${row.toolkit}`, row)
		}

		if (affectedIntegrations.size === 0) {
			return {
				status: "ok" as const,
				cleared: cleared.length,
				notified: 0,
			}
		}

		const affectedRows = [...affectedIntegrations.values()]
		const userIds = [...new Set(affectedRows.map((row) => row.userId))]
		const telegramAccounts =
			userIds.length === 0
				? []
				: yield* query((database) =>
						database
							.select({
								userId: schema.accounts.userId,
								metadata: schema.accounts.metadata,
							})
							.from(schema.accounts)
							.where(
								and(
									eq(schema.accounts.providerId, "telegram"),
									inArray(schema.accounts.userId, userIds),
								),
							),
					)

		const chatIdByUserId = new Map<string, number>()
		for (const account of telegramAccounts) {
			const chatId = getTelegramChatId(account.metadata)
			if (chatId !== undefined && !chatIdByUserId.has(account.userId)) {
				chatIdByUserId.set(account.userId, chatId)
			}
		}

		let notified = 0
		for (const row of affectedRows) {
			const chatId = chatIdByUserId.get(row.userId)
			if (chatId === undefined) continue

			yield* Effect.tryPromise(() =>
				sender.sendMessage(chatId, getIntegrationExpiredMessage(row.toolkit)),
			).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						notified += 1
					}),
				),
				Effect.catchAll((error) =>
					Effect.sync(() => {
						console.error(
							`[Composio] Failed to send reconnect notice to Telegram chat ${chatId}:`,
							error,
						)
					}),
				),
			)
		}

		return {
			status: "ok" as const,
			cleared: cleared.length,
			notified,
		}
	})

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

// OAuth callback proxy — OAuth providers redirect here; we 302 to Composio so the browser shows your API domain (not backend.composio.dev)
app.get("/composio/redirect", (c) => {
	const query = new URL(c.req.url).search
	return c.redirect(`https://backend.composio.dev/api/v3/toolkits/auth/callback${query}`, 302)
})

// Webhook handler — Chat SDK handles secret verification, parsing, and routing via waitUntil
app.post("/telegram/webhook", async (c) => {
	const { chat } = getOrCreateChat(c.env)
	return chat.webhooks.telegram(c.req.raw, {
		waitUntil: (task) => c.executionCtx.waitUntil(task),
	})
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
}

export default Sentry.withSentry<WorkerBindings, TelegramQueueMessage>(getSentryOptions, worker)
