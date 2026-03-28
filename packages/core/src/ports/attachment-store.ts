import { Context, type Effect } from "effect"
import type {
	AttachmentDirection,
	AttachmentKind,
	AttachmentRef,
	AttachmentSource,
	AttachmentStatus,
} from "../domain/attachment"
import type { DbError } from "../errors/core-error"

export interface AttachmentRecord {
	readonly id: string
	readonly userId: string
	readonly conversationId?: string | null
	readonly threadId?: string | null
	readonly messageId?: string | null
	readonly taskId?: string | null
	readonly direction: AttachmentDirection
	readonly source: AttachmentSource
	readonly kind: AttachmentKind
	readonly status: AttachmentStatus
	readonly dedupeKey?: string | null
	readonly mediaType: string
	readonly originalFilename?: string | null
	readonly title?: string | null
	readonly sizeBytes?: number | null
	readonly sha256?: string | null
	readonly r2Key?: string | null
	readonly sourceRef?: Record<string, unknown> | null
	readonly metadata?: Record<string, unknown> | null
	readonly createdAt: Date
	readonly updatedAt: Date
	readonly deletedAt?: Date | null
}

export interface AttachmentRecordInsert {
	readonly id?: string
	readonly userId: string
	readonly conversationId?: string | null
	readonly threadId?: string | null
	readonly messageId?: string | null
	readonly taskId?: string | null
	readonly direction: AttachmentDirection
	readonly source: AttachmentSource
	readonly kind: AttachmentKind
	readonly status: AttachmentStatus
	readonly dedupeKey?: string | null
	readonly mediaType: string
	readonly originalFilename?: string | null
	readonly title?: string | null
	readonly sizeBytes?: number | null
	readonly sha256?: string | null
	readonly r2Key?: string | null
	readonly sourceRef?: Record<string, unknown> | null
	readonly metadata?: Record<string, unknown> | null
	readonly deletedAt?: Date | null
}

export type AttachmentRecordUpdate = Partial<
	Omit<AttachmentRecordInsert, "userId" | "direction" | "source" | "kind" | "mediaType">
>

export interface AttachmentStoreService {
	readonly reserveInboundAttachment: (
		params: AttachmentRecordInsert,
	) => Effect.Effect<AttachmentRecord, DbError>
	readonly createAttachment: (
		params: AttachmentRecordInsert,
	) => Effect.Effect<AttachmentRecord, DbError>
	readonly updateAttachment: (
		attachmentId: string,
		patch: AttachmentRecordUpdate,
	) => Effect.Effect<AttachmentRecord | null, DbError>
	readonly getById: (attachmentId: string) => Effect.Effect<AttachmentRecord | null, DbError>
	readonly getByIdAndUser: (
		attachmentId: string,
		userId: string,
	) => Effect.Effect<AttachmentRecord | null, DbError>
	readonly listByIdsAndUser: (
		attachmentIds: readonly string[],
		userId: string,
	) => Effect.Effect<AttachmentRecord[], DbError>
	readonly listByTaskId: (taskId: string) => Effect.Effect<AttachmentRecord[], DbError>
	readonly getTotalReadyBytesForUser: (userId: string) => Effect.Effect<number, DbError>
}

export class AttachmentStore extends Context.Tag("AttachmentStore")<
	AttachmentStore,
	AttachmentStoreService
>() {}

export function toAttachmentRef(record: AttachmentRecord): AttachmentRef {
	return {
		id: record.id,
		kind: record.kind,
		mediaType: record.mediaType,
		filename: record.originalFilename ?? null,
		sizeBytes: record.sizeBytes ?? null,
		title: record.title ?? record.originalFilename ?? null,
		status: record.status,
		metadata: record.metadata ?? undefined,
	}
}
