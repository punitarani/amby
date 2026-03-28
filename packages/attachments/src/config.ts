export const ATTACHMENT_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024
export const ATTACHMENT_DIRECT_BINARY_LIMIT_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_DIRECT_TEXT_LIMIT_BYTES = 2 * 1024 * 1024
export const ATTACHMENT_USER_QUOTA_BYTES = 1024 * 1024 * 1024
export const ATTACHMENT_DOWNLOAD_TTL_MS = 15 * 60 * 1000

export const DIRECT_MODEL_IMAGE_PREFIX = "image/"
// Media types that reach the final fallback branch in classifyAttachment
// and should still be sent directly to the model. Images, PDFs, and text-like
// types are handled by earlier branches, so only list types that fall through.
export const DIRECT_MODEL_FILE_MEDIA_TYPES = new Set<string>([])
export const TEXT_LIKE_MEDIA_TYPES = new Set([
	"text/plain",
	"text/markdown",
	"text/csv",
	"application/json",
])

export const TEXT_LIKE_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json"])
export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"])
export const INTERNAL_TASK_ARTIFACT_FILENAMES = new Set([
	"result.md",
	"stdout.log",
	"stderr.log",
	"status.json",
])
