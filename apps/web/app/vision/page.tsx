import type { Metadata } from "next"

import { MarketingActionLink } from "@/components/marketing/action-link"
import { marketingLinks } from "@/components/marketing/constants"
import { DreamyImageCard } from "@/components/marketing/dreamy-image-card"
import { MarketingPageShell } from "@/components/marketing/page-shell"
import { SectionLabel } from "@/components/marketing/section-label"
import { GitHubIcon, TelegramIcon } from "@/components/marketing/social-icons"

const visionSections = [
	{
		body: "Amby is a private assistant computer that lives online and stays on. It keeps one working memory, prepares follow-up and prep in the background, and gives you clean review points before anything important moves.",
		label: "What Amby is",
		title: "One assistant state, not a new prompt every time.",
	},
	{
		body: "AI is already useful for writing, summarizing, and organization. What is still missing is a product that remembers safely, acts with permission, and stays understandable under pressure.",
		label: "Why now",
		title: "The gap is continuity, not capability.",
	},
	{
		body: "Amby is for people whose work really does spill across inboxes, calendars, and messages: operators, founders, recruiters, consultants, and small-team professionals who feel the cost when follow-ups slip.",
		label: "Who it is for",
		title: "Busy people with real workflow load.",
	},
	{
		body: "The long-term direction is one persistent assistant you can reach from messaging, email, calendar, desktop, and phone without fragmenting the work. New surfaces should extend the same assistant, not create a new one.",
		label: "Where it goes next",
		title: "From prep layer to continuous personal computing.",
	},
] as const

const principleChips = [
	"Persistent memory",
	"Review before send",
	"Permission-based actioning",
	"Cross-surface continuity",
] as const

const successSignals = [
	"Meetings are prepped before they start.",
	"Follow-ups do not depend on memory alone.",
	"Returning to work does not require re-explaining it.",
] as const

export const metadata: Metadata = {
	alternates: {
		canonical: "/vision",
	},
	description:
		"Why Amby is being built as a personal assistant computer that runs once and stays coherent across the places you work.",
	title: "Vision | AMBY",
}

export default function VisionPage() {
	return (
		<MarketingPageShell
			headerAction={{
				external: true,
				href: marketingLinks.telegram,
				label: "Try Telegram Bot",
			}}
		>
			<section className="mx-auto max-w-[1440px] px-6 pb-18 pt-8 md:px-8 lg:px-[112px] lg:pb-24 lg:pt-16">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,0.96fr)_minmax(22rem,1.04fr)] lg:items-center lg:gap-14">
					<div className="max-w-[39rem]">
						<SectionLabel className="text-primary">Vision</SectionLabel>
						<h1 className="headline-wrap mt-7 [font-family:var(--font-instrument)] text-[clamp(3.8rem,8vw,6.2rem)] leading-[0.91] tracking-[-0.05em] text-foreground">
							A personal assistant
							<br />
							computer you can
							<br />
							actually trust.
						</h1>
						<p className="mt-7 max-w-2xl text-[1.08rem] leading-8 text-foreground/64">
							Like having a great assistant who has their own computer: one persistent workspace,
							clear permissions, and continuity that follows the work instead of restarting per app.
						</p>
						<div className="mt-8 flex flex-wrap gap-4">
							<MarketingActionLink
								analyticsPlacement="vision_hero_primary"
								href={marketingLinks.telegram}
								rel="noreferrer"
								size="large"
								target="_blank"
							>
								<TelegramIcon className="size-3.5" />
								Open Telegram Bot
							</MarketingActionLink>
							<MarketingActionLink
								analyticsPlacement="vision_hero_secondary"
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
						<p className="mt-7 max-w-xl text-[0.98rem] leading-7 text-foreground/56">
							Short-term mission: reduce dropped balls without asking people to adopt a brand new
							inbox or workflow.
						</p>
					</div>

					<div className="space-y-5">
						<div className="marketing-card p-4">
							<DreamyImageCard
								alt="Soft system image representing one assistant state across work surfaces"
								className="aspect-[6/5] rounded-[2rem]"
								priority
								sizes="(min-width: 1024px) 40rem, 100vw"
								src="/images/dreamy-system-square.png"
							/>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="marketing-card p-6">
								<SectionLabel className="text-primary">Current wedge</SectionLabel>
								<p className="mt-4 text-[1rem] leading-7 text-foreground/62">
									Start with follow-up, meeting prep, and context recovery. Earn trust with useful
									work, then expand the surface area.
								</p>
							</div>
							<div className="marketing-card p-6">
								<SectionLabel className="text-primary">Why it matters</SectionLabel>
								<p className="mt-4 text-[1rem] leading-7 text-foreground/62">
									The product only works if it stays legible. Memory, actioning, and approval have
									to feel calm and reviewable.
								</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="section-band border-y border-foreground/8 py-20 lg:py-24">
				<div className="mx-auto max-w-[1440px] px-6 md:px-8 lg:px-[112px]">
					<div className="grid gap-6 lg:grid-cols-12">
						{visionSections.map((section, index) => (
							<article
								className={
									index % 2 === 0
										? "marketing-card p-7 sm:p-8 lg:col-span-7"
										: "marketing-card p-7 sm:p-8 lg:col-span-5"
								}
								key={section.label}
							>
								<SectionLabel className="text-primary">{section.label}</SectionLabel>
								<h2 className="headline-wrap mt-5 max-w-[12ch] [font-family:var(--font-instrument)] text-[2.9rem] leading-[0.98] tracking-[-0.04em] text-foreground sm:text-[3.4rem]">
									{section.title}
								</h2>
								<p className="mt-5 max-w-2xl text-[1rem] leading-8 text-foreground/62">
									{section.body}
								</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-[1440px] px-6 py-20 md:px-8 lg:px-[112px] lg:py-24">
				<div className="grid gap-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(18rem,0.98fr)]">
					<div className="marketing-card px-8 py-12 sm:px-10">
						<SectionLabel className="text-primary">Operating principle</SectionLabel>
						<h2 className="headline-wrap mt-5 max-w-[11ch] [font-family:var(--font-instrument)] text-5xl leading-[0.96] tracking-[-0.045em] text-foreground md:text-6xl">
							Your personal follow-up and prep layer.
						</h2>
						<p className="mt-5 max-w-3xl text-[1.03rem] leading-8 text-foreground/62">
							Amby should feel always on, permission-based, and reviewable. The product earns trust
							by keeping memory coherent, actions explicit, and cross-surface access simple.
						</p>
						<div className="mt-7 flex flex-wrap gap-2.5">
							{principleChips.map((chip) => (
								<span
									className="rounded-full border border-foreground/10 bg-background px-3 py-1.5 font-sans text-[0.63rem] tracking-[0.18em] text-foreground/62 uppercase"
									key={chip}
								>
									{chip}
								</span>
							))}
						</div>
					</div>

					<div className="marketing-card px-8 py-12 sm:px-10">
						<SectionLabel className="text-primary">What success looks like</SectionLabel>
						<div className="mt-5 space-y-4">
							{successSignals.map((signal) => (
								<p
									className="border-t border-foreground/8 pt-4 text-[1rem] leading-7 text-foreground/62"
									key={signal}
								>
									{signal}
								</p>
							))}
						</div>
					</div>
				</div>
			</section>
		</MarketingPageShell>
	)
}
