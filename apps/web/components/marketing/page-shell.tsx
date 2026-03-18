import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

import { MarketingFooter } from "./footer"
import { MarketingHeader, type MarketingHeaderAction } from "./marketing-header"

type MarketingPageShellProps = {
	children: ReactNode
	className?: string
	headerAction?: MarketingHeaderAction
	homeHref?: string
}

export const MarketingPageShell = ({
	children,
	className,
	headerAction,
	homeHref,
}: MarketingPageShellProps) => {
	return (
		<div className="section-shell min-h-screen overflow-x-hidden bg-background text-foreground">
			<div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-64 bg-gradient-to-b from-primary/14 via-primary/5 to-transparent" />
			<MarketingHeader action={headerAction} homeHref={homeHref} />
			<main className={cn("relative z-10 pt-[5.15rem] md:pt-[5.85rem]", className)}>
				{children}
			</main>
			<MarketingFooter />
		</div>
	)
}
