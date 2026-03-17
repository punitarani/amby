import { APP_URL } from "@/lib/app-url"

export const marketingLinks = {
	website: APP_URL,
	github: "https://github.com/punitarani/amby",
	telegram: "https://t.me/my_amby_bot",
} as const

export const marketingBrandLine =
	"Personal assistant computer. Always on, permission-based, and reviewable."

export const marketingWebsiteLabel = new URL(APP_URL).host

export const marketingNavigation = [{ label: "Vision", href: "/vision" }] as const

export type MarketingFooterItem = {
	external?: boolean
	href: string
	label: string
}

export const marketingFooterLinks: MarketingFooterItem[] = [
	{ label: "Vision", href: "/vision" },
	{ label: "Telegram Bot", href: marketingLinks.telegram, external: true },
	{ label: "GitHub Repo", href: marketingLinks.github, external: true },
]
