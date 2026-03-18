import type { NextConfig } from "next"

const DEFAULT_APP_URL = "https://hiamby.com"
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com"
const POSTHOG_PROXY_PATH = "/_a"

const normalizeUrl = (value: string | undefined, fallback: string) => {
	if (!value) return fallback

	return value.replace(/\/+$/, "")
}

const posthogHost = normalizeUrl(process.env.POSTHOG_HOST, DEFAULT_POSTHOG_HOST)

const getPostHogAssetsHost = (host: string) => {
	const url = new URL(host)

	if (!url.hostname.endsWith(".i.posthog.com")) return url.toString().replace(/\/+$/, "")

	url.hostname = url.hostname.replace(".i.posthog.com", "-assets.i.posthog.com")

	return url.toString().replace(/\/+$/, "")
}

const posthogAssetsHost = getPostHogAssetsHost(posthogHost)

const nextConfig: NextConfig = {
	reactStrictMode: true,
	skipTrailingSlashRedirect: true,
	experimental: {
		optimizePackageImports: ["lucide-react"],
	},
	env: {
		NEXT_PUBLIC_APP_URL: process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL,
		NEXT_PUBLIC_POSTHOG_API_HOST: POSTHOG_PROXY_PATH,
		NEXT_PUBLIC_POSTHOG_HOST: posthogHost,
		NEXT_PUBLIC_POSTHOG_KEY: process.env.POSTHOG_KEY ?? "",
	},
	async rewrites() {
		return [
			{
				source: `${POSTHOG_PROXY_PATH}/static/:path*`,
				destination: `${posthogAssetsHost}/static/:path*`,
			},
			{
				source: `${POSTHOG_PROXY_PATH}/:path*`,
				destination: `${posthogHost}/:path*`,
			},
		]
	},
}

export default nextConfig
