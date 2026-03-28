import type { AttachmentKind } from "@amby/core"
import {
	ATTACHMENT_DIRECT_BINARY_LIMIT_BYTES,
	ATTACHMENT_DIRECT_TEXT_LIMIT_BYTES,
	DIRECT_MODEL_FILE_MEDIA_TYPES,
	DIRECT_MODEL_IMAGE_PREFIX,
	IMAGE_EXTENSIONS,
	TEXT_LIKE_EXTENSIONS,
	TEXT_LIKE_MEDIA_TYPES,
} from "./config"

export interface AttachmentPolicyDecision {
	readonly kind: AttachmentKind
	readonly mediaType: string
	readonly directModel: boolean
	readonly directText: boolean
	readonly sandboxOnly: boolean
}

export function getFilenameExtension(filename?: string | null): string | null {
	if (!filename) return null
	const trimmed = filename.trim()
	const dotIndex = trimmed.lastIndexOf(".")
	if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return null
	return trimmed.slice(dotIndex + 1).toLowerCase()
}

export function inferMediaTypeFromFilename(filename?: string | null): string | null {
	const ext = getFilenameExtension(filename)
	if (!ext) return null
	switch (ext) {
		case "png":
			return "image/png"
		case "jpg":
		case "jpeg":
			return "image/jpeg"
		case "gif":
			return "image/gif"
		case "webp":
			return "image/webp"
		case "pdf":
			return "application/pdf"
		case "txt":
			return "text/plain"
		case "md":
		case "markdown":
			return "text/markdown"
		case "csv":
			return "text/csv"
		case "json":
			return "application/json"
		default:
			return null
	}
}

export function defaultFilenameForAttachment(params: {
	attachmentId: string
	kind: AttachmentKind
	mediaType?: string | null
}): string {
	const mediaType = params.mediaType?.trim().toLowerCase() ?? ""
	const extension = (() => {
		if (mediaType === "application/pdf") return "pdf"
		if (mediaType === "text/plain") return "txt"
		if (mediaType === "text/markdown") return "md"
		if (mediaType === "text/csv") return "csv"
		if (mediaType === "application/json") return "json"
		if (mediaType.startsWith("image/")) return mediaType.slice("image/".length) || "img"
		return params.kind === "image" ? "jpg" : params.kind === "pdf" ? "pdf" : "bin"
	})()

	return `${params.attachmentId}.${extension}`
}

export function sanitizeFilename(filename: string): string {
	const cleaned = filename
		.trim()
		.replaceAll(/[^A-Za-z0-9._-]+/g, "-")
		.replaceAll(/-+/g, "-")
		.replace(/^[-.]+/, "")
		.slice(0, 120)
	return cleaned || "attachment.bin"
}

export function classifyAttachment(params: {
	mediaType?: string | null
	filename?: string | null
	sizeBytes?: number | null
}): AttachmentPolicyDecision {
	const mediaType =
		params.mediaType?.trim().toLowerCase() || inferMediaTypeFromFilename(params.filename) || ""
	const extension = getFilenameExtension(params.filename)
	const sizeBytes = params.sizeBytes ?? null
	const isImage =
		mediaType.startsWith(DIRECT_MODEL_IMAGE_PREFIX) ||
		(extension ? IMAGE_EXTENSIONS.has(extension) : false)
	const isPdf = mediaType === "application/pdf" || extension === "pdf"
	const isTextLike =
		TEXT_LIKE_MEDIA_TYPES.has(mediaType) ||
		(extension ? TEXT_LIKE_EXTENSIONS.has(extension) : false)

	if (isImage) {
		return {
			kind: "image",
			mediaType: mediaType || "image/jpeg",
			directModel: sizeBytes === null || sizeBytes <= ATTACHMENT_DIRECT_BINARY_LIMIT_BYTES,
			directText: false,
			sandboxOnly: false,
		}
	}

	if (isPdf) {
		return {
			kind: "pdf",
			mediaType: "application/pdf",
			directModel: sizeBytes === null || sizeBytes <= ATTACHMENT_DIRECT_BINARY_LIMIT_BYTES,
			directText: false,
			sandboxOnly: false,
		}
	}

	if (isTextLike) {
		return {
			kind: "text",
			mediaType: mediaType || "text/plain",
			directModel: sizeBytes === null || sizeBytes <= ATTACHMENT_DIRECT_TEXT_LIMIT_BYTES,
			directText: true,
			sandboxOnly: false,
		}
	}

	return {
		kind: mediaType ? "document" : "binary",
		mediaType: mediaType || "application/octet-stream",
		directModel: DIRECT_MODEL_FILE_MEDIA_TYPES.has(mediaType),
		directText: false,
		sandboxOnly: true,
	}
}

export function summarizeAttachmentCounts(parts: ReadonlyArray<{ kind: AttachmentKind }>): string {
	if (parts.length === 0) return ""
	const counts = new Map<AttachmentKind, number>()
	for (const part of parts) {
		counts.set(part.kind, (counts.get(part.kind) ?? 0) + 1)
	}

	const labels = (
		[
			["image", "image"],
			["pdf", "PDF"],
			["text", "text document"],
			["document", "document"],
			["binary", "file"],
		] as const
	)
		.flatMap(([kind, label]) => {
			const count = counts.get(kind)
			return count ? `${count} ${label}${count === 1 ? "" : "s"}` : []
		})
		.slice(0, 3)

	if (labels.length === 0) return "User sent attachments."
	if (labels.length === 1) return `User sent ${labels[0]}.`
	if (labels.length === 2) return `User sent ${labels[0]} and ${labels[1]}.`
	return `User sent ${labels[0]}, ${labels[1]}, and ${labels[2]}.`
}
