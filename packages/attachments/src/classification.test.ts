import { describe, expect, it } from "bun:test"
import {
	classifyAttachment,
	defaultFilenameForAttachment,
	sanitizeFilename,
	summarizeAttachmentCounts,
} from "./classification"

describe("classifyAttachment", () => {
	it("keeps small images on the direct model path", () => {
		expect(
			classifyAttachment({
				mediaType: "image/png",
				filename: "photo.png",
				sizeBytes: 512_000,
			}),
		).toEqual({
			kind: "image",
			mediaType: "image/png",
			directModel: true,
			directText: false,
			sandboxOnly: false,
		})
	})

	it("keeps large PDFs out of the direct model path without forcing sandbox-only mode", () => {
		expect(
			classifyAttachment({
				mediaType: "application/pdf",
				filename: "whitepaper.pdf",
				sizeBytes: 11 * 1024 * 1024,
			}),
		).toEqual({
			kind: "pdf",
			mediaType: "application/pdf",
			directModel: false,
			directText: false,
			sandboxOnly: false,
		})
	})

	it("treats small markdown files as direct text input", () => {
		expect(
			classifyAttachment({
				filename: "notes.md",
				sizeBytes: 8_192,
			}),
		).toEqual({
			kind: "text",
			mediaType: "text/markdown",
			directModel: true,
			directText: true,
			sandboxOnly: false,
		})
	})

	it("routes unknown binaries to sandbox fallback", () => {
		expect(
			classifyAttachment({
				mediaType: "application/zip",
				filename: "archive.zip",
				sizeBytes: 50_000,
			}),
		).toEqual({
			kind: "document",
			mediaType: "application/zip",
			directModel: false,
			directText: false,
			sandboxOnly: true,
		})
	})
})

describe("attachment naming helpers", () => {
	it("sanitizes unsafe filenames", () => {
		expect(sanitizeFilename("../Quarterly Plan (final).pdf")).toBe("Quarterly-Plan-final-.pdf")
	})

	it("derives default filenames from media type", () => {
		expect(
			defaultFilenameForAttachment({
				attachmentId: "att-1",
				kind: "pdf",
				mediaType: "application/pdf",
			}),
		).toBe("att-1.pdf")
	})
})

describe("summarizeAttachmentCounts", () => {
	it("keeps attachment-only summaries compact", () => {
		expect(summarizeAttachmentCounts([{ kind: "image" }, { kind: "pdf" }, { kind: "text" }])).toBe(
			"User sent 1 image, 1 PDF, and 1 text document.",
		)
	})
})
