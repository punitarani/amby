"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from "react"

import {
	type MarketingLinkKind,
	type MarketingLinkPlacement,
	trackMarketingLinkClicked,
} from "@/lib/posthog"

type MarketingTrackedLinkProps = Omit<ComponentPropsWithoutRef<"a">, "children" | "href"> & {
	children: ReactNode
	external?: boolean
	href: string
	kind: MarketingLinkKind
	placement: MarketingLinkPlacement
}

export const MarketingTrackedLink = ({
	children,
	external = false,
	href,
	kind,
	onClick,
	placement,
	...props
}: MarketingTrackedLinkProps) => {
	const pathname = usePathname()

	const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event)
		if (event.defaultPrevented) return

		trackMarketingLinkClicked({
			placement,
			kind,
			label: event.currentTarget.textContent?.trim() || href,
			href,
			isExternal: external,
			sourcePath: pathname,
		})
	}

	if (external) {
		return (
			<a href={href} onClick={handleClick} {...props}>
				{children}
			</a>
		)
	}

	return (
		<Link href={href} onClick={handleClick} {...props}>
			{children}
		</Link>
	)
}
