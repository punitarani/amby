function normalizeApiBaseUrl(url: string | undefined): string {
	if (!url) return ""
	const trimmed = url.trim()
	if (!trimmed) return ""
	return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

export function getHomeResponse() {
	return {
		api: normalizeApiBaseUrl(process.env.API_URL),
		github: "https://github.com/punitarani/amby",
		telegram: "https://t.me/my_amby_bot",
		message:
			"You've reached the assistant computer, not the front desk. It stays on, does the legwork, and leaves the grand speeches to the website.",
	}
}
