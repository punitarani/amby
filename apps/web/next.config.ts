import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	reactStrictMode: true,
	experimental: {
		optimizePackageImports: ["lucide-react"],
	},
	env: {
		NEXT_PUBLIC_APP_URL:
			process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://hiamby.com",
	},
}

export default nextConfig
