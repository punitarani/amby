import type { Metadata } from "next"

import { MarketingActionLink } from "@/components/marketing/action-link"
import { marketingLinks } from "@/components/marketing/constants"
import { DreamyImageCard } from "@/components/marketing/dreamy-image-card"
import { MarketingPageShell } from "@/components/marketing/page-shell"
import { SectionLabel } from "@/components/marketing/section-label"
import { GitHubIcon, TelegramIcon } from "@/components/marketing/social-icons"

const telegramBenefits = [
	{
		label: "Capture",
		copy: "Drop a loose end into Amby before it disappears. The point is to keep commitments from vanishing between conversations.",
	},
	{
		label: "Prep",
		copy: "Ask for a quick brief before a call, a follow-up scaffold after one, or a simple summary when you need to resume work fast.",
	},
	{
		label: "Review",
		copy: "Approve drafts, reminders, and nudges from one queue instead of rebuilding context across multiple apps.",
	},
] as const

const startPrompts = [
	"Prep me for my 2 p.m. meeting with Acme.",
	"Which threads still need a reply today?",
	"Draft a follow-up for the client call I just finished.",
] as const

export const metadata: Metadata = {
	title: "Telegram Access | AMBY",
	description:
		"Start using Amby on Telegram to capture loose ends, request prep, and review ready-to-send work without switching apps.",
	alternates: {
		canonical: "/telegram-access",
	},
}

export default function TelegramAccessPage() {
	return (
		<MarketingPageShell
			headerAction={{
				href: marketingLinks.telegram,
				label: "Try Telegram Bot",
				external: true,
			}}
		>
			<section className="mx-auto max-w-[1480px] px-6 pb-20 pt-10 md:px-8 lg:px-[88px] lg:pb-24 lg:pt-14">
				<div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
					<div className="marketing-card p-8 sm:p-10 lg:col-span-6">
						<SectionLabel className="text-primary">Telegram access</SectionLabel>
						<h1 className="mt-6 max-w-[10.8ch] [font-family:var(--font-instrument)] text-[clamp(3.1rem,6vw,5.6rem)] leading-[0.94] tracking-[-0.045em] text-foreground">
							Start using Amby where you already message.
						</h1>
						<p className="mt-6 max-w-2xl text-[1.04rem] leading-8 text-foreground/64">
							Telegram is the fastest way to use Amby today. It gives you a low-friction place to
							capture follow-ups, request prep, and review ready-to-send work without switching
							tools.
						</p>
						<div className="mt-8 flex flex-wrap gap-3">
							<MarketingActionLink
								analyticsPlacement="telegram_hero_primary"
								href={marketingLinks.telegram}
								rel="noreferrer"
								size="large"
								target="_blank"
							>
								<TelegramIcon className="size-3.5" />
								Open Telegram Bot
							</MarketingActionLink>
							<MarketingActionLink
								analyticsPlacement="telegram_hero_secondary"
								href="/vision"
								size="large"
								variant="secondary"
							>
								Read the vision
							</MarketingActionLink>
						</div>
					</div>

					<div className="marketing-card p-4 sm:p-5 lg:col-span-6">
						<div className="relative">
							<DreamyImageCard
								alt="Portrait visual representing the messaging-native surface for Amby"
								className="aspect-[5/4] rounded-[2rem] sm:aspect-[6/5]"
								priority
								sizes="(min-width: 1024px) 38rem, 100vw"
								src="/images/dreamy-flow-portrait.png"
							/>
							<div className="pointer-events-none absolute inset-x-6 bottom-6 space-y-2">
								{startPrompts.map((prompt) => (
									<div
										className="w-fit max-w-[88%] rounded-full border border-white/45 bg-background/88 px-4 py-2.5 font-sans text-[0.68rem] font-semibold tracking-[0.04em] text-foreground/72 backdrop-blur-sm"
										key={prompt}
									>
										{prompt}
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-[1480px] px-6 pb-22 md:px-8 lg:px-[88px]">
				<div className="grid gap-5 lg:grid-cols-[0.62fr,0.38fr]">
					<div className="marketing-card p-7 sm:p-8">
						<SectionLabel className="text-primary">What you can do right now</SectionLabel>
						<div className="mt-5 grid gap-4 md:grid-cols-3">
							{telegramBenefits.map((benefit) => (
								<div
									className="rounded-[1.45rem] border border-foreground/8 bg-background/76 p-4"
									key={benefit.label}
								>
									<p className="floating-label text-primary">{benefit.label}</p>
									<p className="mt-3 text-[0.98rem] leading-6 text-foreground/62">{benefit.copy}</p>
								</div>
							))}
						</div>
					</div>

					<div className="marketing-card p-7 sm:p-8">
						<SectionLabel className="text-primary">Why Telegram first</SectionLabel>
						<h2 className="mt-4 max-w-[12ch] [font-family:var(--font-instrument)] text-[2.45rem] leading-[1.02] tracking-[-0.03em] text-foreground">
							No new inbox. No new habit loop.
						</h2>
						<p className="mt-4 text-[1rem] leading-7 text-foreground/62">
							The best launch surface is the one people already open all day. Telegram keeps Amby
							reachable without asking users to adopt a brand-new routine before the product proves
							its value.
						</p>
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-[1480px] px-6 pb-24 md:px-8 lg:px-[88px]">
				<div className="marketing-card px-8 py-12 sm:px-10 lg:px-14 lg:py-14">
					<div className="grid gap-6 lg:grid-cols-[0.6fr,0.4fr] lg:items-center">
						<div>
							<SectionLabel className="text-primary">Next step</SectionLabel>
							<h2 className="mt-4 max-w-[12ch] [font-family:var(--font-instrument)] text-5xl leading-[0.97] tracking-[-0.04em] text-foreground">
								Try the bot, then inspect the model behind it.
							</h2>
							<p className="mt-4 max-w-2xl text-[1rem] leading-7 text-foreground/62">
								Start with the real interaction surface. If the product model makes sense, the
								vision page and repo will show where it is going and how it is being built.
							</p>
						</div>
						<div className="flex flex-wrap gap-3 lg:justify-end">
							<MarketingActionLink
								analyticsPlacement="telegram_final_primary"
								href={marketingLinks.telegram}
								rel="noreferrer"
								size="large"
								target="_blank"
							>
								<TelegramIcon className="size-3.5" />
								Open Telegram Bot
							</MarketingActionLink>
							<MarketingActionLink
								analyticsPlacement="telegram_final_secondary"
								href={marketingLinks.github}
								rel="noreferrer"
								size="large"
								target="_blank"
								variant="secondary"
							>
								<GitHubIcon className="size-3.5" />
								Review the codebase
							</MarketingActionLink>
						</div>
					</div>
				</div>
			</section>
		</MarketingPageShell>
	)
}
