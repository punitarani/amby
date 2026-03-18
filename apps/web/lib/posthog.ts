import posthog from "posthog-js"

const marketingPageTypes = {
	"/": "home",
	"/github": "github",
	"/telegram-access": "telegram_access",
	"/vision": "vision",
} as const

export type MarketingPageType =
	| (typeof marketingPageTypes)[keyof typeof marketingPageTypes]
	| "unknown"

export type MarketingLinkKind = "brand" | "cta" | "footer" | "nav"

export type MarketingLinkPlacement =
	| "footer_github"
	| "footer_telegram"
	| "footer_vision"
	| "github_final_primary"
	| "github_hero_primary"
	| "github_hero_secondary"
	| "header_action"
	| "header_brand"
	| "header_nav_vision"
	| "home_access_primary"
	| "home_access_secondary"
	| "home_hero_primary"
	| "home_hero_secondary"
	| "home_vision_secondary"
	| "telegram_final_primary"
	| "telegram_final_secondary"
	| "telegram_hero_primary"
	| "telegram_hero_secondary"
	| "vision_hero_primary"
	| "vision_hero_secondary"

type TrackMarketingLinkClickedOptions = {
	href: string
	isExternal: boolean
	kind?: MarketingLinkKind
	label: string
	placement: MarketingLinkPlacement
	sourcePath?: string | null
}

export const normalizePathname = (pathname: string | null | undefined) => {
	if (!pathname || pathname === "/") return "/"

	return pathname.replace(/\/+$/, "")
}

export const getMarketingPageType = (pathname: string | null | undefined): MarketingPageType => {
	const normalizedPathname = normalizePathname(pathname)

	return marketingPageTypes[normalizedPathname as keyof typeof marketingPageTypes] ?? "unknown"
}

const getCurrentSourcePath = () => {
	if (typeof window === "undefined") return "/"

	return normalizePathname(window.location.pathname)
}

export const trackMarketingLinkClicked = ({
	href,
	isExternal,
	kind = "cta",
	label,
	placement,
	sourcePath,
}: TrackMarketingLinkClickedOptions) => {
	if (!posthog.__loaded) return

	const resolvedSourcePath = normalizePathname(sourcePath ?? getCurrentSourcePath())

	posthog.capture("web_marketing_link_clicked", {
		placement,
		kind,
		label,
		href,
		is_external: isExternal,
		page_type: getMarketingPageType(resolvedSourcePath),
		source_path: resolvedSourcePath,
	})
}
