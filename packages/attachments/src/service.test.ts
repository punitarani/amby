import { describe, expect, it } from "bun:test"
import type { AttachmentRecord, AttachmentStoreService } from "@amby/core"
import { AttachmentStore } from "@amby/core"
import type { DbError } from "@amby/db"
import type { Env } from "@amby/env"
import { EnvService } from "@amby/env"
import { Effect, Layer } from "effect"
import {
	AttachmentBlobStore,
	AttachmentService,
	AttachmentServiceLive,
	collectAssistantReplyParts,
} from "./service"

const TEST_ENV: Env = {
	NODE_ENV: "test",
	API_URL: "https://api.example.com",
	APP_URL: "https://app.example.com",
	CLOUDFLARE_AI_GATEWAY_ID: "",
	CLOUDFLARE_AI_GATEWAY_BASE_URL: "",
	CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: "",
	OPENROUTER_API_KEY: "",
	OPENAI_API_KEY: "",
	CARTESIA_API_KEY: "",
	DAYTONA_API_KEY: "",
	DAYTONA_API_URL: "",
	DAYTONA_TARGET: "",
	TELEGRAM_BOT_TOKEN: "test-bot-token",
	TELEGRAM_BOT_USERNAME: "amby_bot",
	TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
	TELEGRAM_API_BASE_URL: "https://api.telegram.org",
	ATTACHMENTS_SIGNING_SECRET: "attachments-secret",
	TELEGRAM_LOGIN_WIDGET_ENABLED: true,
	TELEGRAM_MINI_APP_ENABLED: false,
	TELEGRAM_OIDC_CLIENT_ID: "",
	TELEGRAM_OIDC_CLIENT_SECRET: "",
	TELEGRAM_OIDC_REQUEST_PHONE: false,
	TELEGRAM_OIDC_REQUEST_BOT_ACCESS: false,
	TELEGRAM_MAX_AUTH_AGE_SECONDS: 86400,
	COMPOSIO_API_KEY: "",
	COMPOSIO_WEBHOOK_SECRET: "",
	COMPOSIO_AUTH_CONFIG_GMAIL: "",
	COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: "",
	COMPOSIO_AUTH_CONFIG_NOTION: "",
	COMPOSIO_AUTH_CONFIG_SLACK: "",
	COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: "",
	DATABASE_URL: "",
	BETTER_AUTH_SECRET: "",
	BETTER_AUTH_URL: "",
	ENABLE_CUA: false,
	BRAINTRUST_API_KEY: "",
	BRAINTRUST_PROJECT_ID: "",
	POSTHOG_KEY: "",
	POSTHOG_HOST: "",
	AMBY_SANDBOX_PROVISION: undefined,
	AMBY_VOLUME_PROVISION: undefined,
}

function unexpectedCall<A>(label: string) {
	return Effect.dieMessage(`Unexpected attachment store call: ${label}`) as Effect.Effect<
		A,
		DbError
	>
}

function makeAttachmentRecord(overrides?: Partial<AttachmentRecord>): AttachmentRecord {
	return {
		id: overrides?.id ?? "att-1",
		userId: overrides?.userId ?? "user-1",
		conversationId: overrides?.conversationId ?? "conv-1",
		threadId: overrides?.threadId ?? "thread-1",
		messageId: overrides?.messageId ?? null,
		taskId: overrides?.taskId ?? null,
		direction: overrides?.direction ?? "inbound",
		source: overrides?.source ?? "telegram",
		kind: overrides?.kind ?? "text",
		status: overrides?.status ?? "ready",
		dedupeKey: overrides?.dedupeKey ?? null,
		mediaType: overrides?.mediaType ?? "text/markdown",
		originalFilename: overrides?.originalFilename ?? "notes.md",
		title: overrides?.title ?? "notes.md",
		sizeBytes: overrides?.sizeBytes ?? 128,
		sha256: overrides?.sha256 ?? null,
		r2Key: overrides?.r2Key ?? "users/user-1/attachments/att-1/source/notes.md",
		sourceRef: overrides?.sourceRef ?? null,
		metadata: overrides?.metadata ?? {},
		createdAt: overrides?.createdAt ?? new Date("2026-03-27T00:00:00.000Z"),
		updatedAt: overrides?.updatedAt ?? new Date("2026-03-27T00:00:00.000Z"),
		deletedAt: overrides?.deletedAt ?? null,
	}
}

function makeAttachmentStore(records: ReadonlyArray<AttachmentRecord>): AttachmentStoreService {
	const byId = new Map(records.map((record) => [record.id, record]))
	return {
		reserveInboundAttachment: () => unexpectedCall("reserveInboundAttachment"),
		createAttachment: () => unexpectedCall("createAttachment"),
		updateAttachment: (attachmentId, patch) =>
			Effect.succeed(
				byId.has(attachmentId) ? { ...byId.get(attachmentId), ...patch } : null,
			) as Effect.Effect<AttachmentRecord | null, DbError>,
		getById: (attachmentId) =>
			Effect.succeed(byId.get(attachmentId) ?? null) as Effect.Effect<
				AttachmentRecord | null,
				DbError
			>,
		getByIdAndUser: (attachmentId, userId) =>
			Effect.succeed(
				byId.get(attachmentId)?.userId === userId ? (byId.get(attachmentId) ?? null) : null,
			) as Effect.Effect<AttachmentRecord | null, DbError>,
		listByIdsAndUser: (attachmentIds, userId) =>
			Effect.succeed(
				attachmentIds.flatMap((attachmentId) => {
					const record = byId.get(attachmentId)
					return record && record.userId === userId ? [record] : []
				}),
			) as Effect.Effect<AttachmentRecord[], DbError>,
		listByTaskId: (taskId) =>
			Effect.succeed(
				[...byId.values()].filter((record) => record.taskId === taskId),
			) as Effect.Effect<AttachmentRecord[], DbError>,
		getTotalReadyBytesForUser: () => Effect.succeed(0) as Effect.Effect<number, DbError>,
	}
}

function makeAttachmentLayer(params?: {
	records?: ReadonlyArray<AttachmentRecord>
	blobs?: Record<string, ArrayBuffer>
}) {
	const blobs = new Map(Object.entries(params?.blobs ?? {}))
	return AttachmentServiceLive.pipe(
		Layer.provideMerge(Layer.succeed(EnvService, TEST_ENV)),
		Layer.provideMerge(
			Layer.succeed(AttachmentBlobStore, {
				put: async (key: string, body: ArrayBuffer) => {
					blobs.set(key, body)
				},
				get: async (key: string) => {
					const body = blobs.get(key)
					return body ? { body } : null
				},
			}),
		),
		Layer.provideMerge(Layer.succeed(AttachmentStore, makeAttachmentStore(params?.records ?? []))),
	)
}

async function runAttachmentService<A>(
	layer: ReturnType<typeof makeAttachmentLayer>,
	effect: Effect.Effect<A, unknown, AttachmentService>,
) {
	return await Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

describe("collectAssistantReplyParts", () => {
	it("keeps text first and adds attachment refs for deliverable artifacts", () => {
		expect(
			collectAssistantReplyParts({
				text: "Here is the result.",
				artifacts: [
					{
						attachmentId: "att-1",
						kind: "image",
						title: "render.png",
						filename: "render.png",
						mediaType: "image/png",
						metadata: { size: 42 },
					},
					{
						kind: "document",
						title: "ignored.txt",
					},
				],
			}),
		).toEqual([
			{ type: "text", text: "Here is the result." },
			{
				type: "attachment",
				attachment: {
					id: "att-1",
					kind: "image",
					mediaType: "image/png",
					filename: "render.png",
					title: "render.png",
					sizeBytes: 42,
					status: "ready",
					metadata: { size: 42 },
				},
			},
		])
	})
})

describe("AttachmentServiceLive", () => {
	it("signs and verifies attachment download URLs", async () => {
		const layer = makeAttachmentLayer()
		const url = await runAttachmentService(
			layer,
			Effect.flatMap(AttachmentService, (service) => service.buildSignedDownloadUrl("att-1")),
		)
		const parsed = new URL(url)

		await expect(
			runAttachmentService(
				layer,
				Effect.flatMap(AttachmentService, (service) =>
					service.verifySignedDownload({
						attachmentId: "att-1",
						expires: parsed.searchParams.get("expires") ?? "",
						signature: parsed.searchParams.get("sig") ?? "",
					}),
				),
			),
		).resolves.toBeUndefined()
	})

	it("rejects invalid attachment signatures", async () => {
		const layer = makeAttachmentLayer()
		const url = await runAttachmentService(
			layer,
			Effect.flatMap(AttachmentService, (service) => service.buildSignedDownloadUrl("att-1")),
		)
		const parsed = new URL(url)

		await expect(
			runAttachmentService(
				layer,
				Effect.flatMap(AttachmentService, (service) =>
					service.verifySignedDownload({
						attachmentId: "att-1",
						expires: parsed.searchParams.get("expires") ?? "",
						signature: "invalid-signature",
					}),
				),
			),
		).rejects.toThrow("Invalid attachment signature.")
	})

	it("turns ready text attachments into direct text model input", async () => {
		const record = makeAttachmentRecord()
		const body = new TextEncoder().encode("# Summary\n\nThis file is ready.").buffer
		const resolved = await runAttachmentService(
			makeAttachmentLayer({
				records: [record],
				blobs: {
					[record.r2Key ?? ""]: body,
				},
			}),
			Effect.flatMap(AttachmentService, (service) =>
				service.resolveModelMessageContent([
					{
						type: "attachment",
						attachment: {
							id: record.id,
							kind: record.kind,
							mediaType: record.mediaType,
							filename: record.originalFilename,
							title: record.title,
						},
					},
				]),
			),
		)

		expect(resolved).toEqual([
			{
				type: "text",
				text: "Attached file: notes.md\n\n# Summary\n\nThis file is ready.",
			},
		])
	})
})
