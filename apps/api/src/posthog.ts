import { PostHog } from "posthog-node"

let _client: PostHog | null = null

export const getPostHogClient = (apiKey: string, host: string): PostHog => {
	if (!_client) {
		_client = new PostHog(apiKey, {
			host,
			flushAt: 1,
			flushInterval: 0,
		})
	}
	return _client
}

export const shutdownPostHog = async (): Promise<void> => {
	if (_client) {
		await _client.shutdown()
		_client = null
	}
}
