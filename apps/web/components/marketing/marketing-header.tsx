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
	label: "Try Telegram Bot",
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
			<div className="mx-auto max-w-[1440px] px-4 md:px-7 lg:px-[104px]">
				<div className="glass-panel flex h-[3.65rem] items-center justify-between rounded-full border border-foreground/10 px-4 shadow-[0_18px_46px_-36px_rgba(48,56,46,0.42)] sm:h-[3.95rem] sm:px-7">
					<MarketingTrackedLink
						className="font-sans text-[1.95rem] leading-none font-semibold tracking-[0.015em] text-primary sm:text-[2.2rem]"
						href={homeHref}
						kind="brand"
						placement="header_brand"
					>
						AMBY
					</MarketingTrackedLink>

					<nav className="hidden items-center gap-12 md:flex">
						{marketingNavigation.map((item) => (
							<MarketingTrackedLink
								className="floating-label text-[0.59rem] tracking-[0.24em] text-foreground/68 transition hover:text-foreground"
								href={item.href}
								key={item.label}
								kind="nav"
								placement="header_nav_vision"
							>
								{item.label}
							</MarketingTrackedLink>
						))}
					</nav>

					<MarketingActionLink
						analyticsPlacement="header_action"
						className="px-4 py-2 text-[0.56rem] sm:px-6"
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
