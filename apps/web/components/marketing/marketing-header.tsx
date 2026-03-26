import { marketingLinks, marketingNavigation } from "@/components/marketing/constants"

import { MarketingActionLink } from "./action-link"
import { GitHubIcon, TelegramIcon } from "./social-icons"
import { MarketingTrackedLink } from "./tracked-link"

export type MarketingHeaderAction = {
	external?: boolean
	href: string
	label: string
	variant?: "primary" | "secondary"
}

type MarketingHeaderProps = {
	action?: MarketingHeaderAction
	homeHref?: string
}

const defaultAction: MarketingHeaderAction = {
	external: true,
	href: marketingLinks.telegram,
	label: "Open Telegram",
	variant: "primary",
}

export const MarketingHeader = ({
	action = defaultAction,
	homeHref = "/",
}: MarketingHeaderProps) => {
	const resolvedAction = {
		...defaultAction,
		...action,
	}

	const ActionIcon = resolvedAction.href === marketingLinks.github ? GitHubIcon : TelegramIcon

	return (
		<header className="fixed inset-x-0 top-0 z-50 pt-4">
			<div className="mx-auto max-w-[1220px] px-4 md:px-6 lg:px-5">
				<div className="glass-panel flex h-[3.8rem] items-center justify-between rounded-full border border-white/10 px-4 sm:h-[4rem] sm:px-5">
					<MarketingTrackedLink
						className="font-sans text-[1rem] leading-none font-semibold tracking-[0.02em] text-foreground"
						href={homeHref}
						kind="brand"
						placement="header_brand"
					>
						Amby
					</MarketingTrackedLink>

					<nav className="hidden items-center gap-7 lg:flex">
						{marketingNavigation.map((item) => (
							<MarketingTrackedLink
								className="font-sans text-[0.61rem] font-medium tracking-[0.18em] text-foreground/56 uppercase transition hover:text-foreground"
								href={item.href}
								key={item.label}
								kind="nav"
								placement={item.analyticsPlacement}
							>
								{item.label}
							</MarketingTrackedLink>
						))}
					</nav>

					<MarketingActionLink
						analyticsPlacement="header_action"
						className="px-4 py-2.5 text-[0.58rem] sm:px-5"
						href={resolvedAction.href}
						rel={resolvedAction.external ? "noreferrer" : undefined}
						size="compact"
						target={resolvedAction.external ? "_blank" : undefined}
						variant={resolvedAction.variant}
					>
						<ActionIcon className="size-3.5" />
						{resolvedAction.label}
					</MarketingActionLink>
				</div>
			</div>
		</header>
	)
}
