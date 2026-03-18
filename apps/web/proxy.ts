import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const POSTHOG_PROXY_PATH = "/_a"
const INTERNAL_PATH_PREFIXES = [POSTHOG_PROXY_PATH, "/_next"] as const

const isAssetPath = (pathname: string) => pathname.split("/").at(-1)?.includes(".") ?? false

export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl

	if (pathname === "/" || !pathname.endsWith("/") || isAssetPath(pathname)) {
		return NextResponse.next()
	}

	if (INTERNAL_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
		return NextResponse.next()
	}

	const redirectUrl = new URL(pathname.slice(0, -1), request.url)
	redirectUrl.search = request.nextUrl.search

	return NextResponse.redirect(redirectUrl, 308)
}
