"use client"

import { motion, useReducedMotion } from "framer-motion"
import {
	ArrowRight,
	CalendarDays,
	Check,
	Eye,
	MessageSquareMore,
	NotebookPen,
	ScrollText,
	Send,
	ShieldCheck,
} from "lucide-react"
import type { ReactNode } from "react"

import { MarketingActionLink } from "@/components/marketing/action-link"
import {
	marketingBrandLine,
	marketingFooterLinks,
	marketingLinks,
} from "@/components/marketing/constants"
import { MarketingPageShell } from "@/components/marketing/page-shell"
import { SectionLabel } from "@/components/marketing/section-label"
import { GitHubIcon, TelegramIcon } from "@/components/marketing/social-icons"
import { MarketingTrackedLink } from "@/components/marketing/tracked-link"
import { cn } from "@/lib/cn"
import { TELEGRAM_BOT_HANDLE } from "@/lib/telegram"

const heroVideoUrl =
	"https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260324_151826_c7218672-6e92-402c-9e45-f1e0f454bdc4.mp4"

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
	"Telegram today, more surfaces over time, one system underneath.",
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

const ambientQueue = [
	{
		copy: "Meeting brief for review based on yesterday's sync.",
		time: "02:00 AM",
	},
	{
		copy: "End-of-day report compiled and sent.",
		time: "05:00 AM",
	},
	{
		copy: "Unreviewed follow-up draft in your Telegram queue.",
		time: "05:45 PM",
	},
	{
		copy: "Tomorrow's first meeting prepped and waiting.",
		time: "08:00 PM",
	},
] as const

const channelList = ["Messaging", "Desktop", "Voice", "API"] as const

const heroSignals = [
	"Capture loose ends before they disappear.",
	"Keep one reviewable assistant state.",
	"Approve work when the moment arrives.",
] as const

const motionEase = [0.22, 1, 0.36, 1] as const
const shellClassName = "mx-auto max-w-[1220px] px-4 pb-6 md:px-6 lg:px-5"

const HomePanel = ({ children, className }: { children: ReactNode; className?: string }) => (
	<div className={cn("home-panel", className)}>{children}</div>
)

const FooterLinkIcon = ({ label }: { label: string }) => {
	if (label === "Telegram") return <TelegramIcon className="size-3.5" />
	if (label === "GitHub") return <GitHubIcon className="size-3.5" />

	return null
}

const LightRibbon = ({ className }: { className: string }) => (
	<div
		className={cn(
			"pointer-events-none absolute rounded-full border border-white/22 opacity-90 blur-[1px]",
			className,
		)}
	/>
)

const HeroDevice = ({ reduceMotion }: { reduceMotion: boolean | null }) => (
	<motion.div
		animate={
			reduceMotion
				? undefined
				: {
						rotate: [-9, -7, -9],
						y: [0, -10, 0],
					}
		}
		className="absolute bottom-6 right-6 hidden aspect-[1.08] w-[26rem] lg:block"
		initial={false}
		transition={{
			duration: 8,
			ease: "easeInOut",
			repeat: Number.POSITIVE_INFINITY,
		}}
	>
		<div className="absolute inset-0 rounded-[2rem] border border-white/12 bg-[linear-gradient(160deg,rgba(255,255,255,0.07),rgba(255,255,255,0.018)_48%,rgba(0,0,0,0.54)_100%)] shadow-[0_40px_90px_-42px_rgba(0,0,0,0.95)]" />
		<div className="absolute inset-[1.05rem] rounded-[1.6rem] border border-white/8 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.12),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(0,0,0,0.35))]" />
		<div className="absolute left-1/2 top-[18%] size-[6.6rem] -translate-x-1/2 rounded-full border border-white/16 bg-[radial-gradient(circle,rgba(255,255,255,0.9),rgba(255,255,255,0.18)_42%,rgba(255,255,255,0.02)_68%,transparent_72%)] shadow-[0_0_45px_rgba(255,255,255,0.24)]" />
		<div className="absolute inset-x-[22%] top-[33%] h-px bg-white/12" />
		<div className="absolute inset-x-[12%] bottom-[16%] h-[0.35rem] rounded-full bg-white/8" />
	</motion.div>
)

export const MarketingHomePage = () => {
	const reduceMotion = useReducedMotion()

	const reveal = (delay = 0) => ({
		initial: { opacity: 0, y: reduceMotion ? 0 : 18 },
		transition: { delay, duration: reduceMotion ? 0.01 : 0.6, ease: motionEase },
		viewport: { amount: 0.18, once: true },
		whileInView: { opacity: 1, y: 0 },
	})

	return (
		<MarketingPageShell showFooter={false}>
			<div className={shellClassName}>
				<div className="home-shell">
					<section className="relative overflow-hidden rounded-b-[1.8rem] border-b border-white/10">
						<div className="absolute inset-0">
							<video
								autoPlay
								className="size-full scale-[1.12] object-cover object-[center_35%] opacity-22 blur-[12px] saturate-[0.4] brightness-[0.38]"
								loop
								muted
								playsInline
								preload="auto"
								src={heroVideoUrl}
							/>
							<div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_36%),linear-gradient(180deg,rgba(6,8,12,0.66),rgba(7,7,8,0.74)_28%,rgba(4,4,5,0.9)_76%,rgba(4,4,5,0.97)_100%)]" />
							<div className="absolute inset-x-0 top-0 h-[58%] bg-[linear-gradient(180deg,rgba(38,69,104,0.5),rgba(13,14,18,0)_82%)]" />
							<div className="absolute inset-x-0 bottom-0 h-[40%] bg-[radial-gradient(circle_at_bottom,rgba(255,255,255,0.06),transparent_54%)]" />
						</div>

						<LightRibbon className="-left-14 -top-20 h-28 w-80 rotate-[8deg] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.72),rgba(255,255,255,0.18)_38%,rgba(255,255,255,0)_66%)] shadow-[0_0_44px_rgba(255,255,255,0.25)]" />
						<LightRibbon className="-left-12 top-18 h-20 w-64 -rotate-[26deg] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.34),rgba(255,255,255,0.08)_44%,rgba(255,255,255,0)_72%)]" />
						<LightRibbon className="right-6 top-3 h-30 w-72 rotate-[12deg] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.84),rgba(255,255,255,0.18)_36%,rgba(255,255,255,0)_70%)] shadow-[0_0_54px_rgba(255,255,255,0.24)]" />
						<LightRibbon className="right-28 top-20 h-16 w-36 -rotate-[24deg] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.36),rgba(255,255,255,0.08)_46%,rgba(255,255,255,0)_74%)]" />

						<HeroDevice reduceMotion={reduceMotion} />

						<div className="relative z-10 px-5 pb-5 pt-14 sm:px-7 md:px-10 md:pb-7 md:pt-16 lg:px-12 lg:pb-9 lg:pt-[4.55rem]">
							<motion.div
								animate={{ opacity: 1, y: 0 }}
								className="mx-auto max-w-[31.5rem] text-center"
								initial={{ opacity: 0, y: reduceMotion ? 0 : 24 }}
								transition={{ duration: reduceMotion ? 0.01 : 0.72, ease: motionEase }}
							>
								<SectionLabel className="text-foreground/56">
									Runs once. Reaches everywhere.
								</SectionLabel>
								<h1 className="headline-wrap mt-5 font-display text-[clamp(3.05rem,7.1vw,5.15rem)] leading-[0.9] tracking-[-0.058em] text-foreground">
									Your personal
									<br />
									assistant computer
								</h1>
								<p className="mx-auto mt-4 max-w-[32rem] text-[0.96rem] leading-7 text-foreground/68 sm:text-[1rem] sm:leading-8">
									Runs once in the cloud, reaches you everywhere, and helps you capture, remember,
									and act with clear permissions, durable context, and work that continues while you
									are offline.
								</p>
								<div className="mt-6 flex flex-wrap justify-center gap-2.5">
									<MarketingActionLink
										analyticsPlacement="home_hero_primary"
										className="min-w-[10.5rem]"
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
										className="min-w-[9.5rem]"
										href="/vision"
										size="default"
										variant="secondary"
									>
										View Vision
										<ArrowRight className="size-3.5" />
									</MarketingActionLink>
								</div>
								<p className="mt-3.5 text-[0.8rem] leading-6 text-foreground/44">
									Telegram is the current launch surface. More surfaces extend the same system.
								</p>
							</motion.div>

							<motion.div
								animate={{ opacity: 1, y: 0 }}
								className="mt-8 grid gap-2.5 sm:grid-cols-3"
								initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
								transition={{
									delay: 0.08,
									duration: reduceMotion ? 0.01 : 0.62,
									ease: motionEase,
								}}
							>
								{heroSignals.map((signal) => (
									<div
										className="home-panel-soft px-4 py-3 text-[0.88rem] leading-6 text-foreground/66"
										key={signal}
									>
										{signal}
									</div>
								))}
							</motion.div>
						</div>
					</section>

					<div className="space-y-4 p-4 sm:p-5">
						<section className="space-y-2.5" id="how-it-works">
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
											<HomePanel className="h-full px-5 py-5">
												<div className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
													<Icon className="size-4.5 text-foreground" />
												</div>
												<h3 className="mt-4 font-display text-[2rem] leading-[0.96] tracking-[-0.04em] text-foreground">
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

						<section className="grid gap-4 lg:grid-cols-[0.46fr_0.54fr]" id="why-amby">
							<motion.div {...reveal()}>
								<HomePanel className="relative min-h-[18rem] overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
									<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_38%,rgba(255,255,255,0.16),transparent_24%),radial-gradient(circle_at_30%_54%,rgba(255,255,255,0.1),transparent_30%)]" />
									<div className="pointer-events-none absolute left-5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-foreground/72 shadow-[0_16px_40px_-28px_rgba(255,255,255,0.38)]">
										<MessageSquareMore className="size-4" />
									</div>
									<div className="pointer-events-none absolute right-6 top-6 flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-foreground/68">
										<CalendarDays className="size-4" />
									</div>
									<div className="relative flex h-full flex-col justify-center">
										<div className="mx-auto w-full max-w-[18rem]">
											<div className="home-panel-soft flex items-center justify-between rounded-full px-4 py-2.5">
												<div className="flex items-center gap-2.5">
													<div className="flex size-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
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
												<div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
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
								<div className="px-1 py-2 sm:px-2 lg:px-4">
									<SectionLabel>Why Amby</SectionLabel>
									<h2 className="headline-wrap mt-3 max-w-[11ch] font-display text-[clamp(2.8rem,5vw,4.4rem)] leading-[0.92] tracking-[-0.05em] text-foreground">
										Runs once.
										<br />
										Reaches everywhere.
									</h2>
									<div className="mt-4 space-y-2.5">
										{whyBullets.map((point) => (
											<div
												className="flex items-start gap-2.5 text-[0.94rem] leading-6 text-foreground/60"
												key={point}
											>
												<div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
													<Check className="size-3 text-foreground" />
												</div>
												<p>{point}</p>
											</div>
										))}
									</div>
								</div>
							</motion.div>
						</section>

						<section className="space-y-2.5" id="trust">
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
											<HomePanel className="h-full px-5 py-5">
												<div className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
													<Icon className="size-4.5 text-foreground" />
												</div>
												<h3 className="mt-4 font-display text-[1.8rem] leading-[0.96] tracking-[-0.04em] text-foreground">
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

						<section className="grid gap-4 lg:grid-cols-[0.44fr_0.56fr]">
							<motion.div {...reveal()}>
								<HomePanel className="flex h-full min-h-[17rem] flex-col justify-between px-5 py-5 sm:px-6 sm:py-6">
									<div>
										<SectionLabel>Ambient Work</SectionLabel>
										<h2 className="headline-wrap mt-3 max-w-[8ch] font-display text-[clamp(2.35rem,4vw,3.45rem)] leading-[0.92] tracking-[-0.05em] text-foreground">
											The work keeps moving even when you don't.
										</h2>
										<p className="mt-4 max-w-[18rem] text-[0.94rem] leading-6 text-foreground/58">
											Calm personal operations, not productivity theater. Follow-up, prep, and
											continuity keep moving while you handle the rest of your day.
										</p>
									</div>
									<div className="flex items-center justify-between border-t border-white/10 pt-4">
										<p className="font-sans text-[0.65rem] font-medium tracking-[0.18em] text-foreground/46 uppercase">
											Ambient queue
										</p>
										<ArrowRight className="size-4 text-foreground/46" />
									</div>
								</HomePanel>
							</motion.div>

							<div className="grid gap-4 sm:grid-cols-2">
								{ambientQueue.map((item, index) => (
									<motion.div
										{...reveal(index * 0.04)}
										key={item.time}
										whileHover={reduceMotion ? undefined : { y: -3 }}
									>
										<HomePanel className="h-full px-5 py-5">
											<p className="font-sans text-[0.69rem] font-semibold tracking-[0.18em] text-foreground/48 uppercase">
												{item.time}
											</p>
											<p className="mt-3 max-w-[16rem] text-[0.9rem] leading-6 text-foreground/58">
												{item.copy}
											</p>
										</HomePanel>
									</motion.div>
								))}
							</div>
						</section>

						<section
							className="grid gap-4 px-1 py-1 lg:grid-cols-[0.42fr_0.58fr] lg:items-end"
							id="channels"
						>
							<motion.div {...reveal()}>
								<SectionLabel>Channels</SectionLabel>
								<h2 className="headline-wrap mt-3 max-w-[8ch] font-display text-[clamp(2.25rem,4vw,3.55rem)] leading-[0.92] tracking-[-0.05em] text-foreground">
									One assistant.
									<br />
									Many surfaces.
								</h2>
							</motion.div>

							<motion.div {...reveal(0.05)} className="px-1 lg:px-3">
								<div className="space-y-1.5 font-display text-[1.72rem] leading-[0.9] tracking-[-0.04em] text-foreground/92 sm:text-[2rem]">
									{channelList.map((channel) => (
										<div key={channel}>{channel}</div>
									))}
								</div>
								<p className="mt-4 max-w-[28rem] text-[0.9rem] leading-6 text-foreground/54">
									{TELEGRAM_BOT_HANDLE} is the current launch surface. Amby stays available where
									you already communicate, then expands outward without fragmenting the system.
								</p>
							</motion.div>
						</section>

						<section>
							<motion.div {...reveal()}>
								<HomePanel className="relative overflow-hidden px-6 py-8 text-center sm:px-10 sm:py-9">
									<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01)_55%,transparent)]" />
									<div className="relative">
										<SectionLabel className="justify-center">Start</SectionLabel>
										<h2 className="headline-wrap mt-4 font-display text-[clamp(2.6rem,4.7vw,3.7rem)] leading-[0.92] tracking-[-0.05em] text-foreground">
											Stop dropping balls.
										</h2>
										<div className="mt-6 flex flex-wrap justify-center gap-2.5">
											<MarketingActionLink
												analyticsPlacement="home_access_primary"
												className="min-w-[10.5rem]"
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
												className="min-w-[9.5rem]"
												href="/vision"
												size="default"
												variant="secondary"
											>
												View Vision
												<ArrowRight className="size-3.5" />
											</MarketingActionLink>
										</div>
									</div>
								</HomePanel>
							</motion.div>
						</section>

						<footer className="border-t border-white/10 px-2 pt-4 pb-2">
							<div className="flex flex-col gap-4 text-[0.68rem] text-foreground/44 uppercase sm:flex-row sm:items-center sm:justify-between">
								<div className="font-sans text-[0.86rem] font-semibold tracking-[0.03em] text-foreground">
									Amby
								</div>
								<div className="text-[0.63rem] tracking-[0.18em] text-foreground/38">
									{`© ${new Date().getFullYear()} AMBY. ${marketingBrandLine}`}
								</div>
								<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
									{marketingFooterLinks.map((item) => (
										<MarketingTrackedLink
											className="inline-flex items-center gap-1.5 text-[0.63rem] tracking-[0.18em] text-foreground/54 transition hover:text-foreground"
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
