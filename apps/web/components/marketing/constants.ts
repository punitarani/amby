import { APP_URL } from "@/lib/app-url"
import { TELEGRAM_BOT_URL } from "@/lib/telegram"

export const marketingLinks = {
	website: APP_URL,
	github: "https://github.com/punitarani/amby",
	telegram: TELEGRAM_BOT_URL,
} as const

export const marketingBrandLine =
	"Personal assistant computer. Always on, permission-based, and reviewable."

export const marketingWebsiteLabel = new URL(APP_URL).host

export const marketingNavigation = [
	{
		label: "Vision",
		href: "/vision",
		analyticsPlacement: "header_nav_vision",
	},
] as const

export type MarketingFooterItem = {
	analyticsPlacement: "footer_vision" | "footer_telegram" | "footer_github"
	external?: boolean
	href: string
	label: string
}

export const marketingFooterLinks: MarketingFooterItem[] = [
	{ label: "Vision", href: "/vision", analyticsPlacement: "footer_vision" },
	{
		label: "Telegram Bot",
		href: marketingLinks.telegram,
		external: true,
		analyticsPlacement: "footer_telegram",
	},
	{
		label: "GitHub Repo",
		href: marketingLinks.github,
		external: true,
		analyticsPlacement: "footer_github",
	},
]
