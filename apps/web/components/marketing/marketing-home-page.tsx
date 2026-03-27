"use client"

import { motion, useReducedMotion } from "framer-motion"
import {
	CalendarDays,
	Check,
	Eye,
	MessageSquareMore,
	NotebookPen,
	ScrollText,
	Send,
	ShieldCheck,
} from "lucide-react"
import Image from "next/image"
import type { ReactNode } from "react"

import { MarketingActionLink } from "@/components/marketing/action-link"
import { marketingFooterLinks, marketingLinks } from "@/components/marketing/constants"
import { MarketingPageShell } from "@/components/marketing/page-shell"
import { SectionLabel } from "@/components/marketing/section-label"
import { GitHubIcon, TelegramIcon } from "@/components/marketing/social-icons"
import { MarketingTrackedLink } from "@/components/marketing/tracked-link"
import { cn } from "@/lib/cn"

const workflowCards = [
	{
		description: "Drop a loose end in before it disappears between meetings, messages, and tabs.",
		icon: NotebookPen,
		title: "Capture",
	},
	{
		description:
			"Persistent context and reviewable memory stay with the work instead of resetting per surface.",
		icon: ScrollText,
		title: "Remember",
	},
	{
		description:
			"Approve drafts, prep, and reminders instead of reconstructing the thread from scratch.",
		icon: Send,
		title: "Act",
	},
] as const

const whyBullets = [
	"One assistant state instead of fragmented chats.",
	"Background work that continues while you are offline.",
] as const

const trustCards = [
	{
		description:
			"You decide what sends, what schedules, and what stays suggested. Important actions remain explicitly gated.",
		icon: ShieldCheck,
		title: "Permission-based",
	},
	{
		description:
			"Memory is understandable and reviewable, so the system stays useful without becoming a black box.",
		icon: Eye,
		title: "Reviewable memory",
	},
	{
		description:
			"Drafts, reminders, and follow-up leave a trail that stays legible enough to review later.",
		icon: ScrollText,
		title: "Audit-friendly",
	},
] as const

const thesisCards = [
	{
		body: "Amby is not a better prompt box. It is one persistent assistant state that stays with your work across the places you already live.",
		label: "What Amby Is",
		title: "A personal assistant computer, not a chat log.",
	},
	{
		body: "It runs once in the cloud, keeps context there, and becomes reachable from messaging, desktop, email, calendar, and whatever comes next.",
		label: "Why This Shape",
		title: "Runs once in the cloud. Reaches you everywhere.",
	},
	{
		body: "Trust is the product. Memory should be reviewable. Actions should be permission-based. The assistant should stay understandable under pressure.",
		label: "Trust Model",
		title: "Clear memory. Clear permissions. Clear actions.",
	},
	{
		body: "Telegram is the launch surface because it is fast and familiar. Over time, more surfaces extend the same assistant without creating new silos.",
		label: "Where It Goes Next",
		title: "Messaging first. More surfaces over time.",
	},
] as const

const principleChips = [
	"Persistent memory",
	"Background execution",
	"Permission-based actioning",
	"Cross-surface continuity",
] as const

const channelList = ["Messaging", "Desktop", "Web", "Voice", "API"] as const

const motionEase = [0.22, 1, 0.36, 1] as const
const shellClassName = "mx-auto max-w-[1220px] px-4 pb-8 md:px-6 md:pb-9 lg:px-5 lg:pb-10"

const HomePanel = ({ children, className }: { children: ReactNode; className?: string }) => (
	<div className={cn("home-panel", className)}>{children}</div>
)

const FooterLinkIcon = ({ label }: { label: string }) => {
	if (label === "Telegram") return <TelegramIcon className="size-3.5" />
	if (label === "GitHub") return <GitHubIcon className="size-3.5" />

	return null
}

export const MarketingHomePage = () => {
	const reduceMotion = useReducedMotion()

	const reveal = (delay = 0) => ({
		initial: { opacity: reduceMotion ? 1 : 0.82, y: reduceMotion ? 0 : 12 },
		transition: { delay, duration: reduceMotion ? 0.01 : 0.62, ease: motionEase },
		viewport: { amount: 0.2, once: true },
		whileInView: { opacity: 1, y: 0 },
	})

	return (
		<MarketingPageShell showFooter={false}>
			<div className={shellClassName}>
				<div className="home-shell">
					<section className="marketing-home-hero">
						<div aria-hidden className="marketing-home-hero__base" />
						<div aria-hidden className="marketing-home-hero__radial" />
						<div aria-hidden className="marketing-home-hero__ring--lg" />
						<div aria-hidden className="marketing-home-hero__ring--md" />
						<div aria-hidden className="marketing-home-hero__bloom--left" />
						<div aria-hidden className="marketing-home-hero__bloom--right" />
						<div aria-hidden className="marketing-home-hero__bloom--bottom" />
						<div className="relative z-10 px-5 pb-16 pt-22 text-center sm:px-8 sm:pb-18 sm:pt-24 md:px-10 md:pb-20 md:pt-26 lg:px-12 lg:pb-24 lg:pt-30">
							<motion.div className="mx-auto max-w-[36rem]" initial={false}>
								<SectionLabel className="justify-center text-foreground/58">
									Runs once. Reaches everywhere.
								</SectionLabel>
								<h1 className="headline-wrap mt-5 font-display text-[clamp(2.95rem,6.6vw,5.3rem)] leading-[0.9] tracking-[-0.056em] text-foreground">
									Your personal
									<br />
									assistant computer
								</h1>
								<p className="mx-auto mt-4 max-w-[33rem] text-[0.95rem] leading-8 text-foreground/72 sm:text-[1rem]">
									Runs once in the cloud. Reaches you everywhere. Captures, remembers, and follows
									through with clear permissions.
								</p>
								<div className="mt-7 flex flex-wrap justify-center gap-2.5">
									<MarketingActionLink
										analyticsPlacement="home_hero_primary"
										className="min-w-[10.7rem]"
										href={marketingLinks.telegram}
										rel="noreferrer"
										size="default"
										target="_blank"
									>
										<TelegramIcon className="size-3.5" />
										Start on Telegram
									</MarketingActionLink>
									<MarketingActionLink
										analyticsPlacement="home_hero_secondary"
										className="min-w-[10.2rem]"
										href={marketingLinks.github}
										rel="noreferrer"
										size="default"
										target="_blank"
										variant="secondary"
									>
										<GitHubIcon className="size-3.5" />
										GitHub
									</MarketingActionLink>
								</div>
								<p className="mt-4 text-[0.8rem] leading-6 text-foreground/48">
									Like having a great assistant who has their own computer.
								</p>
							</motion.div>
						</div>
					</section>

					<div className="space-y-8 p-4 sm:space-y-9 sm:p-6 md:space-y-10 md:p-7">
						<section className="space-y-3" id="how-it-works">
							<SectionLabel className="pl-1">How It Works</SectionLabel>
							<div className="grid gap-4 md:grid-cols-3">
								{workflowCards.map((card, index) => {
									const Icon = card.icon

									return (
										<motion.div
											{...reveal(index * 0.05)}
											key={card.title}
											whileHover={reduceMotion ? undefined : { y: -3 }}
										>
											<HomePanel className="h-full px-5 py-6">
												<div className="flex size-9 items-center justify-center rounded-xl border border-border-subtle bg-[color:var(--marketing-surface-tint)]">
													<Icon className="size-4.5 text-foreground" />
												</div>
												<h3 className="mt-4 font-display text-[1.96rem] leading-[0.96] tracking-[-0.04em] text-foreground">
													{card.title}
												</h3>
												<p className="mt-3 max-w-[16rem] text-[0.92rem] leading-6 text-foreground/56">
													{card.description}
												</p>
											</HomePanel>
										</motion.div>
									)
								})}
							</div>
						</section>

						<section className="grid gap-5 lg:grid-cols-[0.46fr_0.54fr]" id="why-amby">
							<motion.div {...reveal()}>
								<HomePanel className="relative min-h-[19rem] overflow-hidden px-5 py-6 sm:px-6 sm:py-7">
									<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_38%,rgba(255,255,255,0.16),transparent_24%),radial-gradient(circle_at_30%_54%,rgba(255,255,255,0.1),transparent_30%)]" />
									<div className="pointer-events-none absolute left-5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-[color:var(--marketing-surface-tint)] text-foreground/72 marketing-float-shadow">
										<MessageSquareMore className="size-4" />
									</div>
									<div className="pointer-events-none absolute right-6 top-6 flex size-9 items-center justify-center rounded-full border border-border-subtle bg-[color:var(--marketing-surface-tint)] text-foreground/68">
										<CalendarDays className="size-4" />
									</div>
									<div className="relative flex h-full flex-col justify-center">
										<div className="mx-auto w-full max-w-[18rem]">
											<div className="home-panel-soft flex items-center justify-between rounded-full px-4 py-2.5">
												<div className="flex items-center gap-2.5">
													<div className="flex size-6 items-center justify-center rounded-full border border-border-subtle bg-[color:var(--marketing-surface-tint-mid)]">
														<CalendarDays className="size-3.5 text-foreground/82" />
													</div>
													<p className="font-sans text-[0.64rem] font-semibold tracking-[0.18em] text-foreground/64 uppercase">
														Meeting prep: active
													</p>
												</div>
											</div>
											<div className="home-panel-soft mt-4 ml-7 flex items-center justify-between gap-3 rounded-full px-4 py-2.5">
												<p className="text-[0.82rem] leading-5 text-foreground/64">
													Draft queued for Telegram review
												</p>
												<div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-[color:var(--marketing-surface-tint-mid)]">
													<Send className="size-3 text-foreground/82" />
												</div>
											</div>
											<div className="home-panel-soft mt-3 ml-4 w-fit rounded-full px-4 py-2">
												<p className="text-[0.8rem] leading-5 text-foreground/62">
													Resume point saved for tomorrow
												</p>
											</div>
										</div>
									</div>
								</HomePanel>
							</motion.div>

							<motion.div {...reveal(0.06)} className="flex items-center">
								<div className="px-1 py-3 sm:px-2 lg:px-4">
									<SectionLabel>Why Amby</SectionLabel>
									<h2 className="headline-wrap mt-3 max-w-[11ch] font-display text-[clamp(2.8rem,5vw,4.5rem)] leading-[0.92] tracking-[-0.05em] text-foreground">
										Runs once.
										<br />
										Reaches everywhere.
									</h2>
									<div className="mt-5 space-y-3">
										{whyBullets.map((point) => (
											<div
												className="flex items-start gap-2.5 text-[0.94rem] leading-6 text-foreground/60"
												key={point}
											>
												<div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-[color:var(--marketing-surface-tint-weak)]">
													<Check className="size-3 text-foreground" />
												</div>
												<p>{point}</p>
											</div>
										))}
									</div>
								</div>
							</motion.div>
						</section>

						<section className="space-y-3" id="trust">
							<SectionLabel className="pl-1">Trust</SectionLabel>
							<div className="grid gap-4 md:grid-cols-3">
								{trustCards.map((card, index) => {
									const Icon = card.icon

									return (
										<motion.div
											{...reveal(index * 0.05)}
											key={card.title}
											whileHover={reduceMotion ? undefined : { y: -3 }}
										>
											<HomePanel className="h-full px-5 py-6">
												<div className="flex size-9 items-center justify-center rounded-xl border border-border-subtle bg-[color:var(--marketing-surface-tint)]">
													<Icon className="size-4.5 text-foreground" />
												</div>
												<h3 className="mt-4 font-display text-[1.74rem] leading-[0.96] tracking-[-0.04em] text-foreground">
													{card.title}
												</h3>
												<p className="mt-3 text-[0.9rem] leading-6 text-foreground/56">
													{card.description}
												</p>
											</HomePanel>
										</motion.div>
									)
								})}
							</div>
						</section>

						<section className="grid gap-5 lg:grid-cols-[0.42fr_0.58fr]" id="model">
							<motion.div {...reveal()}>
								<HomePanel className="h-full px-6 py-7 sm:px-7 sm:py-8">
									<SectionLabel>Method</SectionLabel>
									<h2 className="headline-wrap mt-4 max-w-[11ch] font-display text-[clamp(2.55rem,4.7vw,3.95rem)] leading-[0.93] tracking-[-0.05em] text-foreground">
										The product thesis needs to stay simple.
									</h2>
									<p className="mt-5 max-w-[28rem] text-[0.97rem] leading-7 text-foreground/60">
										Amby should feel like personal infrastructure for follow-through: always on,
										permission-based, and understandable enough to live with every day.
									</p>
									<div className="mt-6 flex flex-wrap gap-2.5">
										{principleChips.map((chip) => (
											<span
												className="rounded-full border border-border-subtle bg-[color:var(--marketing-surface-tint-weak)] px-3 py-1.5 font-sans text-[0.66rem] tracking-[0.18em] text-foreground/58 uppercase"
												key={chip}
											>
												{chip}
											</span>
										))}
									</div>
								</HomePanel>
							</motion.div>

							<div className="grid gap-4 sm:grid-cols-2">
								{thesisCards.map((card, index) => (
									<motion.div
										{...reveal(index * 0.04)}
										key={card.label}
										whileHover={reduceMotion ? undefined : { y: -3 }}
									>
										<article
											className={cn(
												"home-panel h-full px-5 py-6",
												index % 2 === 1 &&
													"bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.028))]",
											)}
										>
											<SectionLabel>{card.label}</SectionLabel>
											<h3 className="headline-wrap mt-4 font-display text-[1.78rem] leading-[0.96] tracking-[-0.04em] text-foreground">
												{card.title}
											</h3>
											<p className="mt-3 text-[0.9rem] leading-6 text-foreground/58">{card.body}</p>
										</article>
									</motion.div>
								))}
							</div>
						</section>

						<section
							className="grid gap-6 lg:grid-cols-[0.44fr_0.56fr] lg:items-start"
							id="channels"
						>
							<div className="pl-1 sm:pl-2 lg:pl-6">
								<SectionLabel>Channels</SectionLabel>
								<h2 className="headline-wrap mt-3 max-w-[8ch] font-display text-[clamp(2.7rem,4.9vw,4.15rem)] leading-[0.9] tracking-[-0.052em] text-foreground">
									One assistant.
									<br />
									Many surfaces.
								</h2>
							</div>

							<div className="pt-1 font-display lg:px-2">
								<div className="space-y-0.5 text-[clamp(2rem,3.8vw,3rem)] leading-[0.88] font-semibold tracking-[-0.025em] text-foreground/82">
									{channelList.map((channel, index) => (
										<div
											className={cn(index === 0 ? "text-foreground" : "text-foreground/74")}
											key={channel}
										>
											{channel}
										</div>
									))}
								</div>
								<p className="mt-5 font-sans text-[0.75rem] font-semibold tracking-[0.12em] text-foreground/58 uppercase">
									Telegram is the current launch surface
								</p>
								<p className="mt-2 max-w-[31rem] font-sans text-[1rem] leading-7 font-normal text-foreground/56">
									Amby is natively available where you already communicate.
								</p>
							</div>
						</section>

						<section>
							<motion.div {...reveal()}>
								<HomePanel className="relative overflow-hidden px-6 py-10 text-center sm:px-10 sm:py-11">
									<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01)_55%,transparent)]" />
									<div className="relative">
										<h2 className="headline-wrap font-display text-[clamp(2.7rem,4.8vw,3.9rem)] leading-[0.92] tracking-[-0.05em] text-foreground">
											Your personal compute plane
										</h2>
										<div className="mt-6 flex flex-wrap justify-center gap-2.5">
											<MarketingActionLink
												analyticsPlacement="home_access_primary"
												className="min-w-[10.7rem]"
												href={marketingLinks.telegram}
												rel="noreferrer"
												size="default"
												target="_blank"
											>
												<TelegramIcon className="size-3.5" />
												Start on Telegram
											</MarketingActionLink>
											<MarketingActionLink
												analyticsPlacement="home_access_secondary"
												className="min-w-[10.2rem]"
												href={marketingLinks.github}
												rel="noreferrer"
												size="default"
												target="_blank"
												variant="secondary"
											>
												<GitHubIcon className="size-3.5" />
												GitHub
											</MarketingActionLink>
										</div>
									</div>
								</HomePanel>
							</motion.div>
						</section>

						<footer className="border-t border-border-subtle px-2 pt-5 pb-2">
							<div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.68rem] text-foreground/44">
								<div className="min-w-0 flex flex-col gap-3">
									<div className="inline-flex items-center gap-2 text-foreground">
										<Image
											alt="Amby logo"
											className="size-6 shrink-0 rounded-full"
											height={24}
											src="/logo-icon.png"
											width={24}
										/>
										<span className="font-display text-[1.5rem] leading-none tracking-[-0.028em]">
											Amby
										</span>
									</div>
									<div className="text-[0.63rem] tracking-[0.2em] text-foreground/38 uppercase">
										{`© ${new Date().getFullYear()} AMBY`}
									</div>
								</div>
								<div className="flex min-w-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-x-4">
									{marketingFooterLinks.map((item) => (
										<MarketingTrackedLink
											className="inline-flex items-center gap-1.5 text-[0.63rem] tracking-[0.18em] text-foreground/54 uppercase transition hover:text-foreground"
											external={item.external}
											href={item.href}
											key={item.label}
											kind="footer"
											placement={item.analyticsPlacement}
											rel={item.external ? "noreferrer" : undefined}
											target={item.external ? "_blank" : undefined}
										>
											<FooterLinkIcon label={item.label} />
											{item.label}
										</MarketingTrackedLink>
									))}
								</div>
							</div>
						</footer>
					</div>
				</div>
			</div>
		</MarketingPageShell>
	)
}
