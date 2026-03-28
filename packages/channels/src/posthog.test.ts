import { afterEach, describe, expect, it } from "bun:test"
import { getPostHogClient, shutdownPostHog } from "./posthog"

const POSTHOG_HOST = "https://us.i.posthog.com"

afterEach(async () => {
	await shutdownPostHog()
})

describe("getPostHogClient", () => {
	it("returns null when the api key is missing or whitespace-only", () => {
		expect(getPostHogClient("", POSTHOG_HOST)).toBeNull()
		expect(getPostHogClient("   ", POSTHOG_HOST)).toBeNull()
	})

	it("creates and reuses a client for the same normalized key", () => {
		const client = getPostHogClient(" test-key ", POSTHOG_HOST)

		expect(client).not.toBeNull()
		expect(getPostHogClient("test-key", POSTHOG_HOST)).toBe(client)
	})
})
