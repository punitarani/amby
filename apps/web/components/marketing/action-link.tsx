"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from "react"

import { cn } from "@/lib/cn"
import {
	type MarketingLinkKind,
	type MarketingLinkPlacement,
	trackMarketingLinkClicked,
} from "@/lib/posthog"
import { isTelegramWebUrl } from "@/lib/telegram"

type ActionLinkProps = Omit<ComponentPropsWithoutRef<"a">, "children" | "href"> & {
	analyticsKind?: MarketingLinkKind
	analyticsPlacement?: MarketingLinkPlacement
	children: ReactNode
	href: string
	size?: "compact" | "default" | "large"
	variant?: "primary" | "secondary"
}

const sizeClassNames = {
	compact: "gap-1.5 whitespace-nowrap px-4 py-2.5 text-[0.58rem] tracking-[0.17em] sm:px-5",
	default: "gap-1.5 whitespace-nowrap px-5 py-3 text-[0.62rem] tracking-[0.18em] sm:px-6",
	large: "gap-1.5 whitespace-nowrap px-6 py-3.5 text-[0.64rem] tracking-[0.19em] sm:px-7",
} as const

export const MarketingActionLink = ({
	analyticsKind = "cta",
	analyticsPlacement,
	children,
	className,
	href,
	onClick,
	size = "default",
	target,
	variant = "primary",
	...props
}: ActionLinkProps) => {
	const pathname = usePathname()
	const isExternal = target === "_blank" || /^(?:[a-z]+:)?\/\//i.test(href)
	const telegramPrimary = variant === "primary" && isTelegramWebUrl(href)
	const resolvedClassName = cn(
		"inline-flex items-center justify-center rounded-full border font-sans font-semibold text-pretty uppercase transition duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
		telegramPrimary ? "focus-visible:ring-[#229ED9]/55" : "focus-visible:ring-primary/60",
		sizeClassNames[size],
		variant === "primary"
			? telegramPrimary
				? "marketing-action-link--telegram-cta text-white shadow-[0_18px_48px_-28px_rgba(34,158,217,0.48)] hover:bg-[#1d8bc4] hover:text-white"
				: "marketing-action-link--primary border-white/20 bg-primary text-background shadow-[0_18px_48px_-28px_rgba(255,255,255,0.35)] hover:bg-white"
			: "marketing-action-link--secondary border-white/12 bg-white/[0.03] text-foreground backdrop-blur-xl hover:bg-white/[0.08]",
		className,
	)

	const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event)
		if (event.defaultPrevented || !analyticsPlacement) return

		trackMarketingLinkClicked({
			placement: analyticsPlacement,
			kind: analyticsKind,
			label: event.currentTarget.textContent?.trim() || href,
			href,
			isExternal,
			sourcePath: pathname,
		})
	}

	if (isExternal) {
		return (
			<a className={resolvedClassName} href={href} onClick={handleClick} target={target} {...props}>
				{children}
			</a>
		)
	}

	return (
		<Link className={resolvedClassName} href={href} onClick={handleClick} {...props}>
			{children}
		</Link>
	)
}
