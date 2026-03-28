import { describe, expect, it } from "bun:test"
import {
	CLOUDFLARE_WORKER_VERSION_MESSAGE_LIMIT,
	normalizeWorkerVersionMessage,
	resolveWorkerVersionMessage,
} from "./worker-version-message"

describe("normalizeWorkerVersionMessage", () => {
	it("collapses multiline whitespace into a single line", () => {
		expect(normalizeWorkerVersionMessage("  deploy\n\nmessage   for\tworker  ")).toBe(
			"deploy message for worker",
		)
	})

	it("truncates oversized values to Cloudflare's message limit", () => {
		const message = normalizeWorkerVersionMessage("x".repeat(140))
		expect(message).toHaveLength(CLOUDFLARE_WORKER_VERSION_MESSAGE_LIMIT)
		expect(message.endsWith("...")).toBe(true)
	})
})

describe("resolveWorkerVersionMessage", () => {
	it("prefers an explicit override and normalizes it", () => {
		expect(
			resolveWorkerVersionMessage(
				{ WORKER_VERSION_MESSAGE: "  release\ncandidate   for worker " },
				() => "ignored",
			),
		).toBe("release candidate for worker")
	})

	it("uses the latest git commit subject when no override is provided", () => {
		const gitReader = (args: string[]) => {
			if (args.join(" ") === "log -1 --pretty=%s") {
				return "Replace Worker Chat SDK memory state with a Durable Object adapter (#95)"
			}
			if (args.join(" ") === "rev-parse --short HEAD") return "af4a11b"
			return undefined
		}

		expect(resolveWorkerVersionMessage({}, gitReader)).toBe(
			"Replace Worker Chat SDK memory state with a Durable Object adapter (#95)",
		)
	})

	it("falls back to the short commit sha when git subject lookup fails", () => {
		const gitReader = (args: string[]) =>
			args.join(" ") === "rev-parse --short HEAD" ? "af4a11b" : undefined

		expect(resolveWorkerVersionMessage({}, gitReader)).toBe("amby-api deploy af4a11b")
	})
})
