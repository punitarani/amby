import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AttachmentBlobStore, AttachmentServiceLive, AttachmentStoreLive } from "./service"

const DEFAULT_ATTACHMENT_ROOT = path.join(process.cwd(), ".tmp", "attachments")

export const makeAttachmentBlobStoreLocal = (rootDir = DEFAULT_ATTACHMENT_ROOT) =>
	Layer.effect(
		AttachmentBlobStore,
		Effect.succeed({
			put: async (key: string, body: ArrayBuffer) => {
				const fullPath = path.join(rootDir, key)
				await mkdir(path.dirname(fullPath), { recursive: true })
				await writeFile(fullPath, Buffer.from(body))
			},
			get: async (key: string) => {
				const fullPath = path.join(rootDir, key)
				try {
					const body = await readFile(fullPath)
					return { body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }
				} catch {
					return null
				}
			},
		}),
	)

export const makeAttachmentServicesLocal = (rootDir = DEFAULT_ATTACHMENT_ROOT) =>
	Layer.mergeAll(
		AttachmentStoreLive,
		AttachmentServiceLive.pipe(
			Layer.provideMerge(makeAttachmentBlobStoreLocal(rootDir)),
			Layer.provideMerge(AttachmentStoreLive),
		),
	)
