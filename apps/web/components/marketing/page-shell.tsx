import type { ReactNode } from "react"

import { cn } from "@/lib/cn"

import { MarketingFooter } from "./footer"
import { MarketingHeader, type MarketingHeaderAction } from "./marketing-header"

type MarketingPageShellProps = {
	children: ReactNode
	className?: string
	headerAction?: MarketingHeaderAction
	homeHref?: string
	showFooter?: boolean
}

export const MarketingPageShell = ({
	children,
	className,
	headerAction,
	homeHref,
	showFooter = true,
}: MarketingPageShellProps) => {
	return (
		<div className="section-shell min-h-screen overflow-x-hidden bg-background text-foreground">
			<div className="pointer-events-none fixed inset-0 z-0">
				<div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_60%)]" />
				<div className="absolute -left-20 top-[18rem] size-[24rem] rounded-full bg-white/[0.04] blur-[120px]" />
				<div className="absolute -right-24 top-[8rem] size-[28rem] rounded-full bg-white/[0.05] blur-[160px]" />
			</div>
			<MarketingHeader action={headerAction} homeHref={homeHref} />
			<main className={cn("relative z-10 pt-[5.15rem] md:pt-[5.6rem]", className)}>{children}</main>
			{showFooter ? <MarketingFooter /> : null}
		</div>
	)
}
