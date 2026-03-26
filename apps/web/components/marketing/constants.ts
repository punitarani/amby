import { TELEGRAM_BOT_URL } from "@/lib/telegram"

export const marketingLinks = {
	github: "https://github.com/punitarani/amby",
	telegram: TELEGRAM_BOT_URL,
} as const

export const marketingBrandLine =
	"Your personal assistant computer. Always on, permission-based, and reviewable."

export const marketingNavigation = [
	{
		label: "Product",
		href: "/#how-it-works",
		analyticsPlacement: "header_nav_product",
	},
	{
		label: "Methodology",
		href: "/#why-amby",
		analyticsPlacement: "header_nav_methodology",
	},
	{
		label: "Privacy",
		href: "/#trust",
		analyticsPlacement: "header_nav_privacy",
	},
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
		label: "Telegram",
		href: marketingLinks.telegram,
		external: true,
		analyticsPlacement: "footer_telegram",
	},
	{
		label: "GitHub",
		href: marketingLinks.github,
		external: true,
		analyticsPlacement: "footer_github",
	},
]
