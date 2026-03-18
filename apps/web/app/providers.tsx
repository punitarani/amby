"use client"

import { PostHogProvider } from "@posthog/react"
import { usePathname, useSearchParams } from "next/navigation"
import posthog, { type PostHogConfig } from "posthog-js"
import { type ReactNode, useEffect, useRef } from "react"

import { getMarketingPageType, normalizePathname } from "@/lib/posthog"

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ""
const POSTHOG_API_HOST = process.env.NEXT_PUBLIC_POSTHOG_API_HOST ?? ""
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? ""

const getPostHogUiHost = (host: string) => {
	if (!host) return undefined

	const url = new URL(host)

	if (url.hostname.endsWith(".i.posthog.com")) {
		url.hostname = url.hostname.replace(".i.posthog.com", ".posthog.com")
	}

	return url.toString().replace(/\/+$/, "")
}

const posthogOptions: Partial<PostHogConfig> = {
	api_host: POSTHOG_API_HOST,
	ui_host: getPostHogUiHost(POSTHOG_HOST),
	autocapture: true,
	capture_pageview: false,
	disable_session_recording: true,
	person_profiles: "identified_only",
	debug: process.env.NODE_ENV !== "production",
}

const PostHogPageviewTracker = () => {
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const lastTrackedUrlRef = useRef<string | null>(null)
	const search = searchParams.toString()

	useEffect(() => {
		if (!pathname || !posthog.__loaded) return

		const normalizedPathname = normalizePathname(pathname)
		const currentUrl = search ? `${normalizedPathname}?${search}` : normalizedPathname

		if (lastTrackedUrlRef.current === currentUrl) return

		lastTrackedUrlRef.current = currentUrl

		posthog.capture("$pageview", {
			page_type: getMarketingPageType(normalizedPathname),
			pathname: normalizedPathname,
			search: search ? `?${search}` : "",
		})
	}, [pathname, search])

	return null
}

type ProvidersProps = Readonly<{
	children: ReactNode
}>

export const Providers = ({ children }: ProvidersProps) => {
	useEffect(() => {
		if (!POSTHOG_KEY) return

		if (!posthog.__loaded) {
			posthog.init(POSTHOG_KEY, posthogOptions)
			return
		}

		posthog.set_config(posthogOptions)
	}, [])

	if (!POSTHOG_KEY) return children

	return (
		<PostHogProvider client={posthog}>
			<PostHogPageviewTracker />
			{children}
		</PostHogProvider>
	)
}
