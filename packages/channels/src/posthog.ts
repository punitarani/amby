import { PostHog } from "posthog-node"

let _client: PostHog | null = null

const normalizePostHogApiKey = (apiKey: string) => apiKey.trim()

export const getPostHogClient = (apiKey: string, host: string): PostHog | null => {
	const normalizedApiKey = normalizePostHogApiKey(apiKey)
	if (!normalizedApiKey) {
		return null
	}

	if (!_client) {
		_client = new PostHog(normalizedApiKey, { host })
	}
	return _client
}

export const shutdownPostHog = async (): Promise<void> => {
	if (_client) {
		await _client.shutdown()
		_client = null
	}
}
