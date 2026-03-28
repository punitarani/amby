import {
	type AttachmentRecord,
	type AttachmentStatus,
	AttachmentStore,
	type AttachmentStoreService,
	type BufferedAttachmentPart,
	type BufferedInboundMessage,
	type ConversationMessagePart,
	CoreError,
	type MessageRole,
	type StructuredUserMessage,
	type TelegramAttachmentSourceRef,
	toAttachmentRef,
} from "@amby/core"
import { and, DbService, eq, inArray, isNull, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import { Context, Effect, Layer } from "effect"
import {
	classifyAttachment,
	defaultFilenameForAttachment,
	inferMediaTypeFromFilename,
	sanitizeFilename,
	summarizeAttachmentCounts,
} from "./classification"
import {
	ATTACHMENT_DOWNLOAD_TTL_MS,
	ATTACHMENT_UPLOAD_LIMIT_BYTES,
	ATTACHMENT_USER_QUOTA_BYTES,
	INTERNAL_TASK_ARTIFACT_FILENAMES,
} from "./config"

type AttachmentBlobStoreObject = {
	readonly body: ArrayBuffer
}

export interface AttachmentBlobStoreService {
	readonly put: (key: string, body: ArrayBuffer) => Promise<void>
	readonly get: (key: string) => Promise<AttachmentBlobStoreObject | null>
}

export class AttachmentBlobStore extends Context.Tag("AttachmentBlobStore")<
	AttachmentBlobStore,
	AttachmentBlobStoreService
>() {}

export interface AttachmentServiceService {
	readonly ingestBufferedMessages: (params: {
		userId: string
		conversationId: string
		messages: ReadonlyArray<BufferedInboundMessage>
	}) => Effect.Effect<StructuredUserMessage[], CoreError>
	readonly resolveModelMessageContent: (
		parts: ReadonlyArray<ConversationMessagePart>,
	) => Effect.Effect<unknown[], CoreError>
	readonly linkMessageAttachments: (params: {
		userId: string
		conversationId: string
		threadId: string
		messageId: string
		role: MessageRole
		parts: ReadonlyArray<ConversationMessagePart>
	}) => Effect.Effect<void, CoreError>
	readonly buildSignedDownloadUrl: (attachmentId: string) => Effect.Effect<string, CoreError>
	readonly verifySignedDownload: (params: {
		attachmentId: string
		expires: string
		signature: string
	}) => Effect.Effect<void, CoreError>
	readonly getDownloadResponse: (attachmentId: string) => Effect.Effect<Response, CoreError>
	readonly loadAttachmentContent: (
		attachmentId: string,
	) => Effect.Effect<{ record: AttachmentRecord; body: ArrayBuffer }, CoreError>
	readonly publishTaskArtifacts: (params: {
		userId: string
		taskId: string
		conversationId?: string | null
		threadId?: string | null
		artifacts: ReadonlyArray<{ title?: string; uri?: string; metadata?: Record<string, unknown> }>
		readArtifact: (artifact: {
			title?: string
			uri?: string
			metadata?: Record<string, unknown>
		}) => Promise<ArrayBuffer | null>
	}) => Effect.Effect<PublishedAttachmentArtifact[], CoreError>
}

export class AttachmentService extends Context.Tag("AttachmentService")<
	AttachmentService,
	AttachmentServiceService
>() {}

export interface PublishedAttachmentArtifact {
	readonly kind: string
	readonly title?: string
	readonly uri?: string
	readonly attachmentId: string
	readonly filename?: string
	readonly mediaType: string
	readonly metadata?: Record<string, unknown>
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
	return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
	return arrayBufferToHex(await crypto.subtle.digest("SHA-256", buffer))
}

function encodeBase64Url(value: Uint8Array): string {
	const base64 = Buffer.from(value).toString("base64")
	return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll(/=+$/g, "")
}

function getAttachmentIds(parts: ReadonlyArray<ConversationMessagePart>): string[] {
	return parts.flatMap((part) => (part.type === "attachment" ? [part.attachment.id] : []))
}

function attachmentDownloadPath(
	apiUrl: string,
	attachmentId: string,
	expiresAt: number,
	signature: string,
) {
	const url = new URL(`/attachments/${attachmentId}`, apiUrl)
	url.searchParams.set("expires", String(expiresAt))
	url.searchParams.set("sig", signature)
	return url.toString()
}

async function signDownloadToken(
	secret: string,
	attachmentId: string,
	expiresAt: number,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	)
	const payload = new TextEncoder().encode(`${attachmentId}:${expiresAt}`)
	const signature = await crypto.subtle.sign("HMAC", key, payload)
	return encodeBase64Url(new Uint8Array(signature))
}

async function verifyDownloadToken(
	secret: string,
	attachmentId: string,
	expiresAt: number,
	signature: string,
): Promise<boolean> {
	const expected = await signDownloadToken(secret, attachmentId, expiresAt)
	const a = new TextEncoder().encode(expected)
	const b = new TextEncoder().encode(signature)
	if (a.length !== b.length) return false
	let mismatch = 0
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0)
	}
	return mismatch === 0
}

function buildStorageKey(params: {
	userId: string
	attachmentId: string
	filename?: string | null
	kind: AttachmentRecord["kind"]
	mediaType?: string | null
	variant: "source" | "derived"
}) {
	const filename = sanitizeFilename(
		params.filename ||
			defaultFilenameForAttachment({
				attachmentId: params.attachmentId,
				kind: params.kind,
				mediaType: params.mediaType,
			}),
	)
	return `users/${params.userId}/attachments/${params.attachmentId}/${params.variant}/${filename}`
}

async function fetchTelegramFilePath(params: {
	telegramBotToken: string
	telegramApiBaseUrl?: string
	fileId: string
}): Promise<string> {
	const baseUrl = params.telegramApiBaseUrl || "https://api.telegram.org"
	const response = await fetch(`${baseUrl}/bot${params.telegramBotToken}/getFile`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ file_id: params.fileId }),
	})
	if (!response.ok) {
		throw new Error(`Telegram getFile failed with ${response.status}`)
	}
	const json = (await response.json()) as {
		ok?: boolean
		result?: { file_path?: string }
		description?: string
	}
	if (!json.ok || !json.result?.file_path) {
		throw new Error(json.description || "Telegram file path missing")
	}
	return json.result.file_path
}

async function downloadTelegramFile(params: {
	telegramBotToken: string
	telegramApiBaseUrl?: string
	source: TelegramAttachmentSourceRef
}): Promise<ArrayBuffer> {
	const filePath = await fetchTelegramFilePath({
		telegramBotToken: params.telegramBotToken,
		telegramApiBaseUrl: params.telegramApiBaseUrl,
		fileId: params.source.fileId,
	})
	const baseUrl = params.telegramApiBaseUrl || "https://api.telegram.org"
	const response = await fetch(`${baseUrl}/file/bot${params.telegramBotToken}/${filePath}`)
	if (!response.ok) {
		throw new Error(`Telegram file download failed with ${response.status}`)
	}
	return await response.arrayBuffer()
}

function decodeUtf8(buffer: ArrayBuffer): string {
	return new TextDecoder("utf-8", { fatal: false }).decode(buffer)
}

function buildAttachmentUnavailableNote(record: AttachmentRecord): string {
	const name = record.originalFilename || record.title || record.id
	const status = record.status
	const error =
		record.metadata && typeof record.metadata.error === "string" ? record.metadata.error : undefined
	if (status === "failed") {
		return `Attachment "${name}" could not be ingested: ${error || "ingest failed"}.`
	}
	return `Attachment "${name}" is stored but only available through sandbox fallback in this turn.`
}

function buildAssistantArtifactPart(artifact: {
	attachmentId?: string
	kind: string
	title?: string
	filename?: string
	mediaType?: string
	metadata?: Record<string, unknown>
}): ConversationMessagePart | null {
	if (!artifact.attachmentId || typeof artifact.mediaType !== "string") return null
	return {
		type: "attachment",
		attachment: {
			id: artifact.attachmentId,
			kind:
				artifact.kind === "image"
					? "image"
					: artifact.kind === "pdf"
						? "pdf"
						: artifact.kind === "text"
							? "text"
							: artifact.kind === "document"
								? "document"
								: "binary",
			mediaType: artifact.mediaType,
			filename:
				typeof artifact.filename === "string"
					? artifact.filename
					: typeof artifact.title === "string"
						? artifact.title
						: null,
			title: artifact.title,
			sizeBytes:
				artifact.metadata && typeof artifact.metadata.size === "number"
					? artifact.metadata.size
					: null,
			status: "ready",
			metadata: artifact.metadata,
		},
	}
}

export function collectAssistantReplyParts(params: {
	text: string
	artifacts?: ReadonlyArray<{
		attachmentId?: string
		kind: string
		title?: string
		filename?: string
		mediaType?: string
		metadata?: Record<string, unknown>
	}>
}): ConversationMessagePart[] {
	const parts: ConversationMessagePart[] = []
	if (params.text.trim()) {
		parts.push({ type: "text", text: params.text })
	}
	for (const artifact of params.artifacts ?? []) {
		const part = buildAssistantArtifactPart(artifact)
		if (part) parts.push(part)
	}
	return parts
}

export const AttachmentStoreLive = Layer.effect(
	AttachmentStore,
	Effect.gen(function* () {
		const { query } = yield* DbService

		const service: AttachmentStoreService = {
			reserveInboundAttachment: (params) =>
				query(async (db) => {
					if (params.dedupeKey) {
						const existing = await db
							.select()
							.from(schema.attachments)
							.where(eq(schema.attachments.dedupeKey, params.dedupeKey))
							.limit(1)
						if (existing[0]) {
							return existing[0] as AttachmentRecord
						}
					}

					const inserted = await db
						.insert(schema.attachments)
						.values({
							id: params.id ?? crypto.randomUUID(),
							userId: params.userId,
							conversationId: params.conversationId ?? null,
							threadId: params.threadId ?? null,
							messageId: params.messageId ?? null,
							taskId: params.taskId ?? null,
							direction: params.direction,
							source: params.source,
							kind: params.kind,
							status: params.status ?? "pending",
							dedupeKey: params.dedupeKey ?? null,
							mediaType: params.mediaType,
							originalFilename: params.originalFilename ?? null,
							title: params.title ?? null,
							sizeBytes: params.sizeBytes ?? null,
							sha256: params.sha256 ?? null,
							r2Key: params.r2Key ?? null,
							sourceRef: params.sourceRef ?? null,
							metadata: params.metadata ?? null,
						})
						.returning()
					const record = inserted[0]
					if (!record) {
						throw new Error("Failed to reserve attachment row")
					}
					return record as AttachmentRecord
				}),

			createAttachment: (params) =>
				query(async (db) => {
					const inserted = await db
						.insert(schema.attachments)
						.values({
							id: params.id ?? crypto.randomUUID(),
							userId: params.userId,
							conversationId: params.conversationId ?? null,
							threadId: params.threadId ?? null,
							messageId: params.messageId ?? null,
							taskId: params.taskId ?? null,
							direction: params.direction,
							source: params.source,
							kind: params.kind,
							status: params.status ?? "pending",
							dedupeKey: params.dedupeKey ?? null,
							mediaType: params.mediaType,
							originalFilename: params.originalFilename ?? null,
							title: params.title ?? null,
							sizeBytes: params.sizeBytes ?? null,
							sha256: params.sha256 ?? null,
							r2Key: params.r2Key ?? null,
							sourceRef: params.sourceRef ?? null,
							metadata: params.metadata ?? null,
						})
						.returning()
					const record = inserted[0]
					if (!record) throw new Error("Failed to create attachment row")
					return record as AttachmentRecord
				}),

			updateAttachment: (attachmentId, patch) =>
				query(async (db) => {
					const rows = await db
						.update(schema.attachments)
						.set({ ...patch, updatedAt: new Date() })
						.where(eq(schema.attachments.id, attachmentId))
						.returning()
					return (rows[0] as AttachmentRecord | undefined) ?? null
				}),

			getById: (attachmentId) =>
				query(async (db) => {
					const rows = await db
						.select()
						.from(schema.attachments)
						.where(eq(schema.attachments.id, attachmentId))
						.limit(1)
					return (rows[0] as AttachmentRecord | undefined) ?? null
				}),

			getByIdAndUser: (attachmentId, userId) =>
				query(async (db) => {
					const rows = await db
						.select()
						.from(schema.attachments)
						.where(
							and(eq(schema.attachments.id, attachmentId), eq(schema.attachments.userId, userId)),
						)
						.limit(1)
					return (rows[0] as AttachmentRecord | undefined) ?? null
				}),

			listByIdsAndUser: (attachmentIds, userId) =>
				attachmentIds.length === 0
					? Effect.succeed([])
					: query((db) =>
							db
								.select()
								.from(schema.attachments)
								.where(
									and(
										inArray(schema.attachments.id, attachmentIds),
										eq(schema.attachments.userId, userId),
									),
								),
						),

			listByTaskId: (taskId) =>
				query((db) =>
					db
						.select()
						.from(schema.attachments)
						.where(
							and(eq(schema.attachments.taskId, taskId), isNull(schema.attachments.deletedAt)),
						),
				),

			getTotalReadyBytesForUser: (userId) =>
				query(async (db) => {
					const rows = await db
						.select({ sizeBytes: schema.attachments.sizeBytes })
						.from(schema.attachments)
						.where(
							and(
								eq(schema.attachments.userId, userId),
								eq(schema.attachments.status, "ready"),
								isNull(schema.attachments.deletedAt),
							),
						)
					return rows.reduce((total, row) => total + (row.sizeBytes ?? 0), 0)
				}),
		}

		return service
	}),
)

export const AttachmentServiceLive = Layer.effect(
	AttachmentService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const blobStore = yield* AttachmentBlobStore
		const attachmentStore = yield* AttachmentStore

		const assertUserQuota = (userId: string, sizeBytes?: number | null) =>
			Effect.gen(function* () {
				if (!sizeBytes) return
				const total = yield* attachmentStore.getTotalReadyBytesForUser(userId).pipe(
					Effect.mapError(
						(error) =>
							new CoreError({
								message: `Failed to calculate attachment quota: ${error.message}`,
								cause: error,
							}),
					),
				)
				if (total + sizeBytes > ATTACHMENT_USER_QUOTA_BYTES) {
					return yield* new CoreError({
						message: "Attachment quota exceeded for this user.",
					})
				}
			})

		const loadAttachmentContent = (attachmentId: string) =>
			Effect.gen(function* () {
				const record = yield* attachmentStore.getById(attachmentId).pipe(
					Effect.mapError(
						(error) =>
							new CoreError({
								message: `Failed to load attachment ${attachmentId}: ${error.message}`,
								cause: error,
							}),
					),
				)
				if (!record || !record.r2Key || record.status !== "ready") {
					return yield* new CoreError({
						message: `Attachment ${attachmentId} is not available for download.`,
					})
				}
				const object = yield* Effect.tryPromise({
					try: () => blobStore.get(record.r2Key as string),
					catch: (cause) =>
						new CoreError({
							message: `Failed to read attachment bytes for ${attachmentId}`,
							cause,
						}),
				})
				if (!object) {
					return yield* new CoreError({ message: `Attachment bytes missing for ${attachmentId}` })
				}
				return { record, body: object.body }
			})

		const ingestAttachmentPart = (params: {
			userId: string
			conversationId: string
			part: BufferedAttachmentPart
		}) => {
			const source = params.part.attachment.source
			return Effect.gen(function* () {
				const filename =
					params.part.attachment.filename ||
					source.filename ||
					defaultFilenameForAttachment({
						attachmentId: crypto.randomUUID(),
						kind: params.part.attachment.kind,
						mediaType: params.part.attachment.mediaType,
					})
				const policy = classifyAttachment({
					mediaType: params.part.attachment.mediaType || source.mediaType,
					filename,
					sizeBytes: params.part.attachment.sizeBytes || source.sizeBytes,
				})
				const dedupeKey = `telegram:${source.chatId}:${source.sourceMessageId}:${source.fileUniqueId || source.fileId}`
				const reserved = yield* attachmentStore
					.reserveInboundAttachment({
						userId: params.userId,
						conversationId: params.conversationId,
						direction: "inbound",
						source: "telegram",
						kind: policy.kind,
						status: "pending",
						dedupeKey,
						mediaType: policy.mediaType,
						originalFilename: filename,
						title: params.part.attachment.title ?? filename,
						sizeBytes: params.part.attachment.sizeBytes ?? source.sizeBytes ?? null,
						sourceRef: source as unknown as Record<string, unknown>,
						metadata: {
							directModel: policy.directModel,
							directText: policy.directText,
							sandboxOnly: policy.sandboxOnly,
							mediaGroupId: source.mediaGroupId ?? null,
						},
					})
					.pipe(
						Effect.mapError(
							(error) =>
								new CoreError({
									message: `Failed to reserve attachment row: ${error.message}`,
									cause: error,
								}),
						),
					)

				if (reserved.status !== "ready" || !reserved.r2Key) {
					const declaredSize = reserved.sizeBytes ?? source.sizeBytes ?? null
					if (declaredSize && declaredSize > ATTACHMENT_UPLOAD_LIMIT_BYTES) {
						yield* attachmentStore
							.updateAttachment(reserved.id, {
								status: "failed",
								metadata: {
									...(reserved.metadata ?? {}),
									error: `File exceeds the ${Math.floor(ATTACHMENT_UPLOAD_LIMIT_BYTES / (1024 * 1024))} MB upload limit.`,
								},
							})
							.pipe(
								Effect.mapError(
									(error) =>
										new CoreError({
											message: `Failed to mark oversized attachment ${reserved.id}`,
											cause: error,
										}),
								),
							)
						return {
							type: "attachment" as const,
							attachment: toAttachmentRef({
								...reserved,
								status: "failed" as AttachmentStatus,
								metadata: {
									...(reserved.metadata ?? {}),
									error: `File exceeds the ${Math.floor(ATTACHMENT_UPLOAD_LIMIT_BYTES / (1024 * 1024))} MB upload limit.`,
								},
							}),
						}
					}

					yield* assertUserQuota(params.userId, reserved.sizeBytes ?? source.sizeBytes ?? null)
					yield* attachmentStore.updateAttachment(reserved.id, { status: "downloading" }).pipe(
						Effect.mapError(
							(error) =>
								new CoreError({
									message: `Failed to mark attachment ${reserved.id} as downloading`,
									cause: error,
								}),
						),
					)

					const downloaded = yield* Effect.tryPromise({
						try: () =>
							downloadTelegramFile({
								telegramBotToken: env.TELEGRAM_BOT_TOKEN,
								telegramApiBaseUrl: env.TELEGRAM_API_BASE_URL,
								source,
							}),
						catch: (cause) =>
							new CoreError({
								message: `Failed to download Telegram attachment ${source.fileId}`,
								cause,
							}),
					})

					const r2Key = buildStorageKey({
						userId: params.userId,
						attachmentId: reserved.id,
						filename,
						kind: reserved.kind,
						mediaType: policy.mediaType,
						variant: "source",
					})

					yield* Effect.tryPromise({
						try: () => blobStore.put(r2Key, downloaded),
						catch: (cause) =>
							new CoreError({
								message: `Failed to persist attachment bytes for ${reserved.id}`,
								cause,
							}),
					})

					const hash = yield* Effect.tryPromise({
						try: () => sha256Hex(downloaded),
						catch: (cause) =>
							new CoreError({
								message: `Failed to hash attachment ${reserved.id}`,
								cause,
							}),
					})

					const updatedSize = downloaded.byteLength
					const previewText =
						policy.directText && updatedSize <= 2048
							? decodeUtf8(downloaded).slice(0, 512)
							: undefined
					yield* attachmentStore
						.updateAttachment(reserved.id, {
							status: "ready",
							sizeBytes: updatedSize,
							r2Key,
							sha256: hash,
							metadata: {
								...(reserved.metadata ?? {}),
								previewText,
								directModel: policy.directModel,
								directText: policy.directText,
								sandboxOnly: policy.sandboxOnly,
							},
						})
						.pipe(
							Effect.mapError(
								(error) =>
									new CoreError({
										message: `Failed to finalize attachment ${reserved.id}`,
										cause: error,
									}),
							),
						)

					return {
						type: "attachment" as const,
						attachment: {
							id: reserved.id,
							kind: policy.kind,
							mediaType: policy.mediaType,
							filename,
							sizeBytes: updatedSize,
							title: reserved.title,
							status: "ready" as const,
							metadata: {
								...(reserved.metadata ?? {}),
								previewText,
								directModel: policy.directModel,
								directText: policy.directText,
								sandboxOnly: policy.sandboxOnly,
							},
						},
					}
				}

				return {
					type: "attachment" as const,
					attachment: toAttachmentRef(reserved),
				}
			}).pipe(
				Effect.catchAll((error) =>
					Effect.succeed({
						type: "attachment" as const,
						attachment: {
							id: crypto.randomUUID(),
							kind: params.part.attachment.kind,
							mediaType:
								params.part.attachment.mediaType ||
								source.mediaType ||
								inferMediaTypeFromFilename(params.part.attachment.filename) ||
								"application/octet-stream",
							filename: params.part.attachment.filename || source.filename,
							sizeBytes: params.part.attachment.sizeBytes || source.sizeBytes,
							title: params.part.attachment.title || params.part.attachment.filename || null,
							status: "failed" as const,
							metadata: {
								error: error.message,
							},
						},
					}),
				),
			)
		}

		return {
			ingestBufferedMessages: ({ userId, conversationId, messages }) =>
				Effect.forEach(messages, (message) =>
					Effect.gen(function* () {
						const convertedParts: ConversationMessagePart[] = []
						for (const part of message.parts) {
							if (part.type === "text") {
								convertedParts.push(part)
								continue
							}
							convertedParts.push(
								yield* ingestAttachmentPart({
									userId,
									conversationId,
									part,
								}),
							)
						}

						const contentText =
							message.textSummary.trim() ||
							summarizeAttachmentCounts(
								convertedParts.flatMap((part) =>
									part.type === "attachment" ? [{ kind: part.attachment.kind }] : [],
								),
							)

						return {
							contentText,
							parts: convertedParts,
						} satisfies StructuredUserMessage
					}),
				),

			resolveModelMessageContent: (parts) =>
				Effect.gen(function* () {
					const resolved: unknown[] = []
					for (const part of parts) {
						if (part.type === "text") {
							resolved.push({ type: "text", text: part.text })
							continue
						}

						const loaded = yield* loadAttachmentContent(part.attachment.id).pipe(
							Effect.catchAll(() => Effect.succeed(null)),
						)
						if (!loaded) {
							resolved.push({
								type: "text",
								text: `Attachment "${part.attachment.title || part.attachment.filename || part.attachment.id}" is unavailable in this turn.`,
							})
							continue
						}
						const { record, body } = loaded

						const policy = classifyAttachment({
							mediaType: record.mediaType,
							filename: record.originalFilename,
							sizeBytes: record.sizeBytes,
						})

						if (policy.directText) {
							resolved.push({
								type: "text",
								text: `Attached file: ${record.originalFilename || record.id}\n\n${decodeUtf8(body)}`,
							})
							continue
						}

						if (policy.kind === "image" && policy.directModel) {
							resolved.push({
								type: "image",
								image: new Uint8Array(body),
								mediaType: policy.mediaType,
							})
							continue
						}

						if (policy.kind === "pdf" && policy.directModel) {
							resolved.push({
								type: "file",
								data: new Uint8Array(body),
								mediaType: policy.mediaType,
								filename: record.originalFilename || undefined,
							})
							continue
						}

						resolved.push({
							type: "text",
							text: buildAttachmentUnavailableNote(record),
						})
					}

					return resolved
				}),

			linkMessageAttachments: ({ conversationId, threadId, messageId, parts }) =>
				Effect.forEach(getAttachmentIds(parts), (attachmentId) =>
					attachmentStore.updateAttachment(attachmentId, {
						conversationId,
						threadId,
						messageId,
					}),
				).pipe(
					Effect.asVoid,
					Effect.mapError(
						(error) =>
							new CoreError({
								message: `Failed to link message attachments: ${error.message}`,
								cause: error,
							}),
					),
				),

			buildSignedDownloadUrl: (attachmentId) =>
				Effect.tryPromise({
					try: async () => {
						const expiresAt = Date.now() + ATTACHMENT_DOWNLOAD_TTL_MS
						const signature = await signDownloadToken(
							env.ATTACHMENTS_SIGNING_SECRET,
							attachmentId,
							expiresAt,
						)
						return attachmentDownloadPath(env.API_URL, attachmentId, expiresAt, signature)
					},
					catch: (cause) =>
						new CoreError({
							message: `Failed to sign download URL for ${attachmentId}`,
							cause,
						}),
				}),

			verifySignedDownload: ({ attachmentId, expires, signature }) =>
				Effect.tryPromise({
					try: async () => {
						const expiresAt = Number(expires)
						if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
							throw new Error("Download link expired.")
						}
						const ok = await verifyDownloadToken(
							env.ATTACHMENTS_SIGNING_SECRET,
							attachmentId,
							expiresAt,
							signature,
						)
						if (!ok) throw new Error("Invalid attachment signature.")
					},
					catch: (cause) =>
						new CoreError({
							message:
								cause instanceof Error ? cause.message : "Attachment download verification failed.",
							cause,
						}),
				}),

			getDownloadResponse: (attachmentId) =>
				Effect.gen(function* () {
					const { record, body } = yield* loadAttachmentContent(attachmentId)
					const headers = new Headers()
					headers.set("Content-Type", record.mediaType || "application/octet-stream")
					const dispositionType =
						record.mediaType?.startsWith("image/") || record.mediaType === "application/pdf"
							? "inline"
							: "attachment"
					const filename = sanitizeFilename(
						record.originalFilename ||
							record.title ||
							defaultFilenameForAttachment({
								attachmentId: record.id,
								kind: record.kind,
								mediaType: record.mediaType,
							}),
					)
					headers.set("Content-Disposition", `${dispositionType}; filename="${filename}"`)
					if (record.sizeBytes) {
						headers.set("Content-Length", String(record.sizeBytes))
					}
					return new Response(body, { headers })
				}),

			loadAttachmentContent,

			publishTaskArtifacts: ({
				userId,
				taskId,
				conversationId,
				threadId,
				artifacts,
				readArtifact,
			}) =>
				Effect.forEach(artifacts, (artifact) =>
					Effect.gen(function* () {
						const filename = artifact.title || artifact.uri?.split("/").pop() || null
						if (!filename || INTERNAL_TASK_ARTIFACT_FILENAMES.has(filename)) {
							return null
						}
						const buffer = yield* Effect.tryPromise({
							try: () => readArtifact(artifact),
							catch: (cause) =>
								new CoreError({
									message: `Failed to read task artifact ${filename}`,
									cause,
								}),
						})
						if (!buffer) return null

						yield* assertUserQuota(userId, buffer.byteLength)
						const policy = classifyAttachment({
							mediaType: inferMediaTypeFromFilename(filename),
							filename,
							sizeBytes: buffer.byteLength,
						})
						const record = yield* attachmentStore
							.createAttachment({
								userId,
								taskId,
								conversationId: conversationId ?? null,
								threadId: threadId ?? null,
								direction: "outbound",
								source: "task_artifact",
								kind: policy.kind,
								status: "pending",
								mediaType: policy.mediaType,
								originalFilename: filename,
								title: filename,
								sizeBytes: buffer.byteLength,
								metadata: {
									directModel: policy.directModel,
									directText: policy.directText,
									sandboxOnly: policy.sandboxOnly,
								},
							})
							.pipe(
								Effect.mapError(
									(error) =>
										new CoreError({
											message: `Failed to create task artifact attachment: ${error.message}`,
											cause: error,
										}),
								),
							)
						const r2Key = buildStorageKey({
							userId,
							attachmentId: record.id,
							filename,
							kind: record.kind,
							mediaType: record.mediaType,
							variant: "source",
						})

						yield* Effect.tryPromise({
							try: () => blobStore.put(r2Key, buffer),
							catch: (cause) =>
								new CoreError({
									message: `Failed to store task artifact ${filename}`,
									cause,
								}),
						})

						const sha = yield* Effect.tryPromise({
							try: () => sha256Hex(buffer),
							catch: (cause) =>
								new CoreError({
									message: `Failed to hash task artifact ${filename}`,
									cause,
								}),
						})

						yield* attachmentStore
							.updateAttachment(record.id, {
								status: "ready",
								r2Key,
								sha256: sha,
							})
							.pipe(
								Effect.mapError(
									(error) =>
										new CoreError({
											message: `Failed to finalize task artifact ${filename}`,
											cause: error,
										}),
								),
							)

						const published: PublishedAttachmentArtifact = {
							kind: policy.kind,
							title: filename,
							uri: `attachment://${record.id}`,
							attachmentId: record.id,
							filename,
							mediaType: policy.mediaType,
							metadata: {
								size: buffer.byteLength,
							},
						}
						return published
					}),
				).pipe(
					Effect.map((rows) =>
						rows.filter((row): row is PublishedAttachmentArtifact => row !== null),
					),
				),
		}
	}),
)
