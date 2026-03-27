import { marketingBrandLine, marketingFooterLinks } from "@/components/marketing/constants"
import { GitHubIcon, TelegramIcon } from "@/components/marketing/social-icons"
import { MarketingTrackedLink } from "./tracked-link"

export const MarketingFooter = () => {
	return (
		<footer className="border-t border-border-subtle py-14 md:py-16">
			<div className="mx-auto max-w-[1220px] px-6 md:px-6 lg:px-5">
				<div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
					<div className="max-w-[24rem]">
						<p className="font-sans text-[1.1rem] leading-none font-semibold tracking-[0.04em] text-foreground">
							Amby
						</p>
						<p className="mt-4 text-[0.98rem] leading-7 text-foreground/58">{marketingBrandLine}</p>
					</div>

					<div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
						{marketingFooterLinks.map((item) => (
							<MarketingTrackedLink
								className="inline-flex items-center gap-2 text-[0.92rem] leading-7 text-foreground/64 transition hover:text-foreground"
								external={item.external}
								href={item.href}
								key={item.label}
								kind="footer"
								placement={item.analyticsPlacement}
								rel={item.external ? "noreferrer" : undefined}
								target={item.external ? "_blank" : undefined}
							>
								{item.label === "Telegram" ? (
									<TelegramIcon className="size-4" />
								) : item.label === "GitHub" ? (
									<GitHubIcon className="size-4" />
								) : null}
								{item.label}
							</MarketingTrackedLink>
						))}
					</div>
				</div>
			</div>
		</footer>
	)
}
