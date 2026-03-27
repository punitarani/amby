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
				<div className="marketing-shell__vignette-top absolute inset-x-0 top-0 h-72" />
				<div className="marketing-shell__bloom-left absolute -left-20 top-[18rem] size-[24rem] rounded-full blur-[120px]" />
				<div className="marketing-shell__bloom-right absolute -right-24 top-[8rem] size-[28rem] rounded-full blur-[160px]" />
			</div>
			<MarketingHeader action={headerAction} homeHref={homeHref} />
			<main className={cn("relative z-10 pt-[6.8rem] md:pt-[7.2rem]", className)}>{children}</main>
			{showFooter ? <MarketingFooter /> : null}
		</div>
	)
}
