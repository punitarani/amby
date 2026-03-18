const DEFAULT_APP_URL = "https://hiamby.com"

const normalizeAppUrl = (value: string | undefined) => {
	if (!value) return DEFAULT_APP_URL

	return value.replace(/\/+$/, "")
}

export const APP_URL = normalizeAppUrl(
	process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL,
)
