import type { WorkerBindings } from "@amby/env/workers"
import { Effect, Layer } from "effect"
import { AttachmentBlobStore, AttachmentServiceLive, AttachmentStoreLive } from "./service"

export const makeAttachmentBlobStoreFromBindings = (bindings: WorkerBindings) =>
	Layer.effect(
		AttachmentBlobStore,
		Effect.succeed({
			put: async (key: string, body: ArrayBuffer) => {
				if (!bindings.ATTACHMENTS_BUCKET) {
					throw new Error("ATTACHMENTS_BUCKET binding is not configured")
				}
				await bindings.ATTACHMENTS_BUCKET.put(key, body)
			},
			get: async (key: string) => {
				if (!bindings.ATTACHMENTS_BUCKET) {
					throw new Error("ATTACHMENTS_BUCKET binding is not configured")
				}
				const object = await bindings.ATTACHMENTS_BUCKET.get(key)
				if (!object) return null
				return { body: await object.arrayBuffer() }
			},
		}),
	)

export const makeAttachmentServicesFromBindings = (bindings: WorkerBindings) =>
	Layer.mergeAll(
		AttachmentStoreLive,
		AttachmentServiceLive.pipe(
			Layer.provideMerge(makeAttachmentBlobStoreFromBindings(bindings)),
			Layer.provideMerge(AttachmentStoreLive),
		),
	)
