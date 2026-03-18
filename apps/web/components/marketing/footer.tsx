import Link from "next/link"

import { marketingBrandLine, marketingFooterLinks } from "@/components/marketing/constants"
import { GitHubIcon, TelegramIcon } from "@/components/marketing/social-icons"

export const MarketingFooter = () => {
	return (
		<footer className="border-t border-foreground/8 py-14 md:py-16">
			<div className="mx-auto max-w-[1440px] px-6 md:px-8 lg:px-[112px]">
				<div className="flex flex-col gap-8 md:gap-10">
					<div className="max-w-[22rem]">
						<p className="font-sans text-[2.1rem] leading-none font-semibold tracking-[0.015em] text-primary">
							AMBY
						</p>
						<p className="mt-4 text-[1rem] leading-7 text-foreground/62">{marketingBrandLine}</p>
					</div>

					<div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-foreground/8 pt-6">
						{marketingFooterLinks.map((item) => (
							<Link
								className="inline-flex items-center gap-2 text-[0.98rem] leading-7 text-foreground/72 transition hover:text-primary"
								href={item.href}
								key={item.label}
								rel={item.external ? "noreferrer" : undefined}
								target={item.external ? "_blank" : undefined}
							>
								{item.label === "Telegram Bot" ? (
									<TelegramIcon className="size-4" />
								) : item.label === "GitHub Repo" ? (
									<GitHubIcon className="size-4" />
								) : null}
								{item.label}
							</Link>
						))}
					</div>
				</div>
			</div>
		</footer>
	)
}
