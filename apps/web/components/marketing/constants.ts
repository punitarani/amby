import { TELEGRAM_BOT_URL } from "@/lib/telegram"

export const marketingLinks = {
	github: "https://github.com/punitarani/amby",
	telegram: TELEGRAM_BOT_URL,
} as const

export const marketingBrandLine = "Your Personal Compute Plane"

export type MarketingFooterItem = {
	analyticsPlacement: "footer_telegram" | "footer_github"
	external?: boolean
	href: string
	label: string
}

export const marketingFooterLinks: MarketingFooterItem[] = [
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
