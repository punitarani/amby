import type { Metadata } from "next"

import { MarketingActionLink } from "@/components/marketing/action-link"
import { marketingLinks } from "@/components/marketing/constants"
import { MarketingPageShell } from "@/components/marketing/page-shell"
import { SectionLabel } from "@/components/marketing/section-label"
import { GitHubIcon, TelegramIcon } from "@/components/marketing/social-icons"

const visionSections = [
	{
		body: "Amby is not a better prompt box. It is one persistent assistant state that stays with your work across the places you already live.",
		label: "What Amby is",
		title: "A personal assistant computer, not a chat log.",
	},
	{
		body: "It runs once in the cloud, keeps the context there, and becomes reachable from messaging, desktop, email, calendar, and whatever comes next.",
		label: "Why this shape",
		title: "Runs once in the cloud. Reaches you everywhere.",
	},
	{
		body: "Trust is the product. Memory should be reviewable. Actions should be permission-based. The assistant should stay understandable under pressure.",
		label: "Trust",
		title: "Clear memory. Clear permissions. Clear actions.",
	},
	{
		body: "Telegram is the launch surface because it is fast and familiar. Over time, more surfaces should extend the same assistant without creating new silos.",
		label: "Where it goes next",
		title: "Messaging first. More surfaces over time.",
	},
] as const

const principleChips = [
	"Persistent memory",
	"Background execution",
	"Permission-based actioning",
	"Cross-surface continuity",
] as const

const successSignals = [
	"Meetings are prepped before they start.",
	"Follow-ups do not depend on memory alone.",
	"Returning to work does not require re-explaining it.",
] as const

const roadmapPhases = [
	{
		body: "Start with follow-up, meeting prep, reminder queues, and continuity inside the surface people already open all day.",
		label: "Phase 1",
		title: "Telegram launch surface",
	},
	{
		body: "Extend to more access points without changing the core model: same assistant state, more ways to reach it.",
		label: "Phase 2",
		title: "Cross-surface assistant",
	},
	{
		body: "Long-term, Amby becomes a durable personal computing layer that more agents and devices can plug into with permission.",
		label: "Phase 3",
		title: "Ambient personal infrastructure",
	},
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
				label: "Open Telegram",
			}}
		>
			<section className="mx-auto max-w-[1480px] px-6 pb-20 pt-10 md:px-8 lg:px-[88px] lg:pb-24 lg:pt-20">
				<div className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-end lg:gap-12">
					<div className="max-w-[44rem]">
						<SectionLabel>Vision</SectionLabel>
						<h1 className="headline-wrap mt-6 font-display text-[clamp(3.35rem,7vw,6.4rem)] leading-[0.89] tracking-[-0.06em] text-foreground">
							A personal assistant computer you can actually trust.
						</h1>
						<p className="mt-6 max-w-[42rem] text-[1.04rem] leading-8 text-foreground/68 sm:text-[1.1rem] sm:leading-9">
							Like having a great assistant who has their own computer: one persistent workspace,
							clear permissions, and continuity that follows the work instead of restarting per app.
						</p>
						<div className="mt-8 flex flex-wrap gap-3">
							<MarketingActionLink
								analyticsPlacement="vision_hero_primary"
								href={marketingLinks.telegram}
								rel="noreferrer"
								size="large"
								target="_blank"
							>
								<TelegramIcon className="size-3.5" />
								Open Telegram
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
						<p className="mt-6 max-w-xl text-[0.97rem] leading-7 text-foreground/54">
							Short-term mission: reduce dropped balls without asking people to adopt a brand-new
							inbox or workflow.
						</p>
					</div>

					<div className="space-y-4">
						<div className="liquid-glass rounded-[2.2rem] p-6 sm:p-8">
							<SectionLabel>Core thesis</SectionLabel>
							<h2 className="headline-wrap mt-4 max-w-[12ch] font-display text-[2.35rem] leading-[0.94] tracking-[-0.04em] text-foreground sm:text-[2.8rem]">
								Runs once in the cloud. Reaches you from wherever you are.
							</h2>
							<p className="mt-4 text-[1rem] leading-7 text-foreground/62">
								The product only works if new surfaces extend the same assistant instead of creating
								a fresh chat history and a fresh trust problem.
							</p>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="marketing-card p-6">
								<SectionLabel>Current wedge</SectionLabel>
								<p className="mt-4 text-[1rem] leading-7 text-foreground/62">
									Follow-up, meeting prep, reminders, and context recovery for busy people whose day
									lives in messaging, email, and calendar.
								</p>
							</div>
							<div className="marketing-card p-6">
								<SectionLabel>Why it matters</SectionLabel>
								<p className="mt-4 text-[1rem] leading-7 text-foreground/62">
									Continuity is the missing layer. The work should survive the gaps between apps,
									meetings, and moments of attention.
								</p>
							</div>
						</div>
						<div className="flex flex-wrap gap-2.5">
							{principleChips.map((chip) => (
								<span
									className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-sans text-[0.66rem] tracking-[0.18em] text-foreground/58 uppercase"
									key={chip}
								>
									{chip}
								</span>
							))}
						</div>
					</div>
				</div>
			</section>

			<section className="section-band border-y border-white/10 py-20 lg:py-24">
				<div className="mx-auto max-w-[1480px] px-6 md:px-8 lg:px-[88px]">
					<div className="max-w-[44rem]">
						<SectionLabel>Model</SectionLabel>
						<h2 className="headline-wrap mt-5 font-display text-[clamp(2.85rem,5vw,4.8rem)] leading-[0.92] tracking-[-0.05em] text-foreground">
							The product thesis needs to stay simple.
						</h2>
						<p className="mt-5 text-[1rem] leading-8 text-foreground/64 sm:text-[1.04rem]">
							Amby should feel like personal infrastructure for follow-through: always on,
							permission-based, and understandable enough to live with every day.
						</p>
					</div>
					<div className="mt-10 grid gap-4 lg:grid-cols-2">
						{visionSections.map((section, index) => (
							<article
								className={
									index % 2 === 0
										? "marketing-card p-7 sm:p-8"
										: "liquid-glass rounded-[2rem] p-7 sm:p-8"
								}
								key={section.label}
							>
								<SectionLabel>{section.label}</SectionLabel>
								<h2 className="headline-wrap mt-5 max-w-[13ch] font-display text-[2.45rem] leading-[0.96] tracking-[-0.04em] text-foreground sm:text-[3rem]">
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

			<section className="mx-auto max-w-[1480px] px-6 py-20 md:px-8 lg:px-[88px] lg:py-24">
				<div className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr]">
					<div className="marketing-card px-8 py-12 sm:px-10">
						<SectionLabel>Near-term job</SectionLabel>
						<h2 className="headline-wrap mt-5 max-w-[11ch] font-display text-[clamp(2.7rem,4.6vw,4.4rem)] leading-[0.94] tracking-[-0.05em] text-foreground">
							Capture, remember, and act without losing the thread.
						</h2>
						<p className="mt-5 max-w-3xl text-[1.02rem] leading-8 text-foreground/62">
							That is the consumer promise at launch. If Amby can reduce dropped balls in the places
							people already work, it earns the right to become a broader personal computing layer.
						</p>
					</div>

					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						<div className="liquid-glass rounded-[2rem] px-8 py-12 sm:px-10">
							<SectionLabel>What success looks like</SectionLabel>
							<div className="mt-5 space-y-4">
								{successSignals.map((signal) => (
									<p
										className="border-t border-white/10 pt-4 text-[1rem] leading-7 text-foreground/62"
										key={signal}
									>
										{signal}
									</p>
								))}
							</div>
						</div>
						{roadmapPhases.map((phase) => (
							<article className="marketing-card px-8 py-12 sm:px-10" key={phase.label}>
								<SectionLabel>{phase.label}</SectionLabel>
								<h3 className="headline-wrap mt-4 font-display text-[2rem] leading-[0.96] tracking-[-0.04em] text-foreground">
									{phase.title}
								</h3>
								<p className="mt-4 text-[0.98rem] leading-7 text-foreground/62">{phase.body}</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-[1480px] px-6 pb-20 md:px-8 lg:px-[88px] lg:pb-24">
				<div className="liquid-glass rounded-[2.4rem] px-6 py-12 text-center sm:px-8 sm:py-14 lg:px-12">
					<SectionLabel>Start</SectionLabel>
					<h2 className="headline-wrap mt-5 font-display text-[clamp(2.8rem,5vw,4.7rem)] leading-[0.92] tracking-[-0.05em] text-foreground">
						Start with the real launch surface.
					</h2>
					<p className="mx-auto mt-5 max-w-[38rem] text-[1rem] leading-8 text-foreground/64 sm:text-[1.04rem]">
						Open Amby on Telegram today. If you want the broader context, the repo shows the product
						direction and implementation in public.
					</p>
					<div className="mt-8 flex flex-wrap justify-center gap-3">
						<MarketingActionLink
							analyticsPlacement="vision_hero_primary"
							href={marketingLinks.telegram}
							rel="noreferrer"
							size="large"
							target="_blank"
						>
							<TelegramIcon className="size-3.5" />
							Open Telegram
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
				</div>
			</section>
		</MarketingPageShell>
	)
}
