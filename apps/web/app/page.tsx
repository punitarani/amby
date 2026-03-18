"use client"

import { motion } from "framer-motion"
import { ArrowUpRight } from "lucide-react"
import type { ReactNode } from "react"

import { MarketingActionLink } from "@/components/marketing/action-link"
import { marketingLinks } from "@/components/marketing/constants"
import { DreamyImageCard } from "@/components/marketing/dreamy-image-card"
import { MarketingPageShell } from "@/components/marketing/page-shell"
import { SectionLabel } from "@/components/marketing/section-label"
import { GitHubIcon, TelegramIcon } from "@/components/marketing/social-icons"
import { cn } from "@/lib/cn"

const workflowArtifacts = [
	{
		label: "Remember",
		title: "See what still needs an owner.",
		description:
			"Amby surfaces the conversations, commitments, and follow-ups most likely to slip.",
	},
	{
		label: "Resume",
		title: "Reopen the thread with the brief ready.",
		description:
			"History, key people, and the next decision are already assembled when you return to the work.",
	},
	{
		label: "Act",
		title: "Approve a batch of follow-ups.",
		description:
			"Review drafts, reminders, and meeting prep instead of rebuilding context one message at a time.",
	},
] as const

const dayMoments = [
	{
		time: "08:10",
		title: "Morning brief",
		description:
			"Start with one brief: priorities, urgent messages, and the meetings that need prep.",
	},
	{
		time: "10:05",
		title: "Inbox triage",
		description:
			"See which threads need a reply today and review suggested drafts before they pile up.",
	},
	{
		time: "12:40",
		title: "Meeting prep",
		description:
			"Before each call, Amby assembles the context, open questions, and follow-up points.",
	},
	{
		time: "15:25",
		title: "Follow-up nudge",
		description:
			"When a commitment is drifting, Amby surfaces who needs a nudge first and drafts it.",
	},
	{
		time: "17:40",
		title: "Review queue",
		description:
			"Approve the day's remaining drafts, nudges, and notes in one place before you log off.",
	},
	{
		time: "19:20",
		title: "Clean shutdown",
		description: "End the day with open loops pinned, scheduled, and ready for tomorrow.",
	},
] as const

const operatingPoints = [
	{
		title: "One assistant state",
		description:
			"Every thread, note, and follow-up lands in one private workspace, so context does not reset when you switch tools.",
	},
	{
		title: "Reach it from anywhere",
		description:
			"Telegram, desktop, phone, email, and calendar become access points into the same assistant instead of separate silos.",
	},
	{
		title: "Review before action",
		description:
			"Drafts, prep notes, and nudges show up ready for approval so the system stays legible and easy to trust.",
	},
] as const

const surfaceLabels = [
	{ label: "Calendar", className: "left-1/2 top-7 -translate-x-1/2" },
	{ label: "Telegram", className: "left-8 top-24" },
	{ label: "Desktop", className: "right-8 top-24" },
	{ label: "Phone", className: "left-10 bottom-10" },
	{ label: "Email", className: "right-10 bottom-10" },
] as const

const motionEase = [0.22, 1, 0.36, 1] as const
const inViewViewport = { once: true, amount: 0.24 } as const

const revealVariants = {
	hidden: { opacity: 1, y: 0 },
	show: {
		opacity: 1,
		y: 0,
		transition: {
			duration: 0.58,
			ease: motionEase,
		},
	},
}

const staggerVariants = {
	hidden: {},
	show: {
		transition: {
			staggerChildren: 0.08,
		},
	},
}

type SectionCardProps = {
	children: ReactNode
	className?: string
}

const SectionCard = ({ children, className }: SectionCardProps) => {
	return (
		<motion.div
			className={cn("marketing-card", className)}
			variants={revealVariants}
			whileHover={{ y: -1.5 }}
		>
			{children}
		</motion.div>
	)
}

export default function HomePage() {
	return (
		<MarketingPageShell>
			<section className="mx-auto max-w-[1440px] px-6 pb-18 pt-6 md:px-8 lg:px-[112px] lg:pb-24 lg:pt-12">
				<div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.02fr)_minmax(32rem,0.98fr)] lg:gap-12 xl:gap-14">
					<motion.div
						animate="show"
						className="max-w-[43rem]"
						initial="hidden"
						variants={staggerVariants}
					>
						<motion.div variants={revealVariants}>
							<SectionLabel className="text-primary">Personal ambient assistant</SectionLabel>
							<h1 className="headline-wrap mt-5 max-w-[10.8ch] [font-family:var(--font-instrument)] text-[clamp(3.12rem,10.3vw,6.25rem)] leading-[0.9] tracking-[-0.05em] text-foreground sm:max-w-[12.1ch] lg:max-w-none">
								A personal assistant
								<br />
								<span className="font-serif text-[0.94em] italic">that stays with the work.</span>
							</h1>
						</motion.div>
						<motion.p
							className="mt-5 max-w-[34rem] text-[1.03rem] leading-8 text-foreground/66 sm:text-[1.06rem]"
							variants={revealVariants}
						>
							Amby is a private assistant computer that lives online and stays on. It helps you
							remember, resume, and act across email, calendar, and messaging.
						</motion.p>
						<motion.div className="mt-7 flex flex-wrap gap-3.5" variants={revealVariants}>
							<motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.99 }}>
								<MarketingActionLink
									analyticsPlacement="home_hero_primary"
									href={marketingLinks.telegram}
									rel="noreferrer"
									size="large"
									target="_blank"
								>
									<TelegramIcon className="size-3.5" />
									Open Telegram Bot
									<ArrowUpRight className="size-3.5" />
								</MarketingActionLink>
							</motion.div>
							<motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.99 }}>
								<MarketingActionLink
									analyticsPlacement="home_hero_secondary"
									href={marketingLinks.github}
									rel="noreferrer"
									size="large"
									target="_blank"
									variant="secondary"
								>
									<GitHubIcon className="size-3.5" />
									Review the codebase
								</MarketingActionLink>
							</motion.div>
						</motion.div>
						<motion.p
							className="mt-5 max-w-[32rem] text-[0.97rem] leading-7 text-foreground/55"
							variants={revealVariants}
						>
							Amby reduces dropped balls: follow-ups happen, meetings are prepped, and inbox triage
							gets done before you ask.
						</motion.p>
					</motion.div>

					<motion.div
						animate={{ opacity: 1, y: 0 }}
						className="relative mx-auto w-full max-w-[43rem]"
						initial={{ opacity: 0.7, y: 22 }}
						transition={{ duration: 0.58, ease: motionEase, delay: 0.08 }}
					>
						<div className="relative rounded-[3rem] border border-foreground/8 bg-background/76 p-3.5 shadow-[0_24px_72px_-42px_rgba(67,76,67,0.42)]">
							<motion.div
								animate={{ opacity: [0.18, 0.3, 0.18], scale: [0.97, 1.04, 0.97] }}
								className="pointer-events-none absolute inset-5 rounded-full bg-primary/20 blur-3xl"
								transition={{ duration: 7.5, repeat: Number.POSITIVE_INFINITY }}
							/>
							<DreamyImageCard
								alt="Dreamy morning visual representing a calm assistant workspace"
								className="aspect-[4/5] rounded-[2.55rem] border-white/35"
								imageClassName="scale-[1.05]"
								priority
								sizes="(min-width: 1280px) 43rem, (min-width: 1024px) 40rem, 92vw"
								src="/images/dreamy-morning.png"
							/>
							<div className="absolute -bottom-4 left-4 max-w-[12.5rem] rounded-[1.45rem] border border-foreground/8 bg-background/92 p-4 shadow-[0_18px_48px_-34px_rgba(57,64,56,0.36)] backdrop-blur-sm sm:left-6">
								<SectionLabel className="text-primary">Morning brief ready</SectionLabel>
								<p className="mt-2 text-[0.93rem] leading-6 text-foreground/64">
									Priorities, inbox risk, and meeting prep arrive before the first context switch.
								</p>
							</div>
						</div>
					</motion.div>
				</div>
			</section>

			<motion.section
				className="section-band border-y border-foreground/7"
				initial="hidden"
				variants={revealVariants}
				whileInView="show"
				viewport={inViewViewport}
			>
				<div className="mx-auto max-w-[1320px] px-6 py-24 md:px-8 lg:px-[112px] lg:py-32">
					<SectionLabel>Why it matters</SectionLabel>
					<h2 className="mt-6 max-w-[52rem] [font-family:var(--font-instrument)] text-[clamp(3.15rem,6.4vw,5.75rem)] leading-[1.01] tracking-[-0.042em] text-foreground">
						The problem is not access to information. It is losing the thread between messages,
						meetings, and follow-ups.
					</h2>
				</div>
			</motion.section>

			<section
				className="mx-auto max-w-[1440px] scroll-mt-36 px-6 py-24 md:scroll-mt-32 md:px-8 lg:px-[112px] lg:py-32"
				id="product"
			>
				<div className="space-y-8 lg:space-y-10">
					<div className="grid gap-12 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] lg:gap-16">
						<motion.div
							className="max-w-[27rem] lg:sticky lg:top-[7.5rem] lg:self-start lg:pt-8"
							initial="hidden"
							variants={revealVariants}
							whileInView="show"
							viewport={inViewViewport}
						>
							<SectionLabel>Product</SectionLabel>
							<h2 className="headline-wrap mt-5 max-w-[13.8ch] [font-family:var(--font-instrument)] text-[clamp(3.1rem,5.15vw,5.2rem)] leading-[0.93] tracking-[-0.045em] text-foreground">
								Work is scattered
								<br />
								across too many surfaces.
							</h2>
							<p className="mt-6 max-w-md text-[1.05rem] leading-8 text-foreground/62">
								Your day lives across email, calendar, and messaging. Amby keeps one assistant state
								across them, so follow-up and prep do not restart every time you switch tabs.
							</p>
						</motion.div>

						<motion.div
							className="space-y-6"
							initial="hidden"
							variants={staggerVariants}
							whileInView="show"
							viewport={inViewViewport}
						>
							<SectionCard className="overflow-hidden p-5 sm:p-6">
								<div className="relative rounded-[2.15rem] border border-foreground/8 bg-background/86 p-4 sm:p-5">
									<DreamyImageCard
										alt="Connected inbox, calendar, and notes layers on a dreamy backdrop"
										className="aspect-[15/9] rounded-[1.8rem]"
										sizes="(min-width: 1024px) 52rem, 100vw"
										src="/images/dreamy-flow-landscape.png"
									/>
									<div className="pointer-events-none absolute inset-0">
										<div className="absolute left-[7%] top-[22%] w-[24%] rounded-2xl border border-foreground/8 bg-background/92 p-4 backdrop-blur-sm">
											<p className="font-sans text-[0.8rem] font-semibold tracking-[0.03em] text-foreground/82">
												Inbox
											</p>
											<div className="mt-3 h-1.5 rounded-full bg-foreground/10" />
											<div className="mt-2 h-1.5 w-[72%] rounded-full bg-foreground/7" />
										</div>
										<div className="absolute right-[8%] top-[15%] w-[28%] rounded-2xl border border-foreground/8 bg-background/92 p-4 backdrop-blur-sm">
											<p className="font-sans text-[0.8rem] font-semibold tracking-[0.03em] text-foreground/82">
												Calendar
											</p>
											<div className="mt-3 grid grid-cols-4 gap-1.5">
												<div className="h-4 rounded bg-foreground/8" />
												<div className="h-4 rounded bg-foreground/8" />
												<div className="h-4 rounded bg-primary/34" />
												<div className="h-4 rounded bg-foreground/8" />
											</div>
										</div>
										<div className="absolute bottom-[16%] left-[31%] w-[34%] rounded-2xl border border-foreground/8 bg-background/94 p-4 backdrop-blur-sm">
											<p className="font-sans text-[0.8rem] font-semibold tracking-[0.03em] text-foreground/82">
												Notes
											</p>
											<div className="mt-3 h-1.5 rounded-full bg-foreground/10" />
											<div className="mt-2 h-1.5 rounded-full bg-foreground/8" />
											<div className="mt-2 h-1.5 w-[66%] rounded-full bg-foreground/7" />
										</div>
									</div>
								</div>
								<p className="mt-5 max-w-2xl text-[0.98rem] leading-7 text-foreground/62">
									Instead of starting from a blank prompt every time, Amby keeps the thread warm and
									brings the right context back when the next action matters.
								</p>
							</SectionCard>
						</motion.div>
					</div>

					<motion.div
						className="scroll-mt-36 space-y-5 md:scroll-mt-32"
						id="workflow"
						initial="hidden"
						variants={staggerVariants}
						whileInView="show"
						viewport={inViewViewport}
					>
						<div className="max-w-[54rem] px-1">
							<SectionLabel>Workflow</SectionLabel>
							<h2 className="headline-wrap mt-4 max-w-[16ch] [font-family:var(--font-instrument)] text-[clamp(2.6rem,4.35vw,4.35rem)] leading-[0.97] tracking-[-0.04em] text-foreground">
								Remember, resume, and act without rebuilding context.
							</h2>
							<p className="mt-4 max-w-[42rem] text-[1rem] leading-7 text-foreground/62">
								Amby is your personal follow-up and prep layer. It keeps context warm, prepares the
								next move, and helps you act without switching apps or re-explaining the work.
							</p>
						</div>
						<div className="grid gap-4 lg:grid-cols-3">
							{workflowArtifacts.map((artifact) => (
								<SectionCard className="h-full p-5 sm:p-6" key={artifact.label}>
									<div className="flex h-full flex-col gap-4">
										<div>
											<SectionLabel className="text-primary">{artifact.label}</SectionLabel>
											<h3 className="headline-wrap mt-3 max-w-[14ch] [font-family:var(--font-instrument)] text-[1.55rem] leading-[1.05] tracking-[-0.03em] text-foreground sm:text-[1.7rem]">
												{artifact.title}
											</h3>
										</div>
										<p className="max-w-none text-[0.95rem] leading-6 text-foreground/62">
											{artifact.description}
										</p>
									</div>
								</SectionCard>
							))}
						</div>
					</motion.div>
				</div>
			</section>

			<section className="border-y border-foreground/8 bg-background-elevated py-24 lg:py-32">
				<div className="mx-auto max-w-[1440px] px-6 md:px-8 lg:px-[112px]">
					<motion.div
						className="mx-auto max-w-3xl text-center"
						initial="hidden"
						variants={revealVariants}
						whileInView="show"
						viewport={inViewViewport}
					>
						<SectionLabel>Ecosystem</SectionLabel>
						<h2 className="headline-wrap mt-6 [font-family:var(--font-instrument)] text-5xl leading-[0.96] tracking-[-0.04em] text-foreground md:text-6xl">
							System model
						</h2>
						<p className="mx-auto mt-5 max-w-2xl text-[1.03rem] leading-8 text-foreground/62">
							One assistant core, reached through Telegram, desktop, phone, email, and calendar
							without fragmenting the work.
						</p>
					</motion.div>

					<motion.div
						className="mt-12 space-y-6"
						initial="hidden"
						variants={staggerVariants}
						whileInView="show"
						viewport={inViewViewport}
					>
						<SectionCard className="relative overflow-hidden p-6 sm:p-8 lg:p-10">
							<div className="relative h-[18rem] rounded-[2.2rem] border border-foreground/8 bg-background/90 sm:h-[21rem] lg:h-[24rem]">
								<div className="absolute inset-0 flex items-center justify-center">
									<motion.div
										animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.76, 1, 0.76] }}
										className="size-[12.5rem] rounded-full bg-[radial-gradient(circle_at_40%_38%,rgba(233,244,230,0.98),rgba(141,160,142,0.78)_58%,rgba(113,132,114,0.58)_100%)] shadow-[0_22px_48px_-18px_rgba(65,81,68,0.44)]"
										transition={{ duration: 8.5, repeat: Number.POSITIVE_INFINITY }}
									/>
									<p className="absolute [font-family:var(--font-instrument)] text-[1.85rem] text-background">
										Amby Core
									</p>
								</div>
								<svg
									aria-label="Connections from Amby Core to supported surfaces"
									className="absolute inset-0 size-full"
									fill="none"
									role="img"
									viewBox="0 0 640 360"
								>
									<title>Connections from Amby Core to supported surfaces</title>
									<path d="M320 66 C320 104, 320 118, 320 132" stroke="rgba(118,130,119,0.52)" />
									<path d="M132 138 C212 138, 240 166, 260 180" stroke="rgba(118,130,119,0.52)" />
									<path d="M508 138 C428 138, 400 166, 380 180" stroke="rgba(118,130,119,0.52)" />
									<path d="M166 294 C232 294, 252 240, 273 212" stroke="rgba(118,130,119,0.52)" />
									<path d="M474 294 C408 294, 388 240, 367 212" stroke="rgba(118,130,119,0.52)" />
								</svg>
								{surfaceLabels.map((surface) => (
									<p
										className={cn(
											"absolute [font-family:var(--font-instrument)] text-[1.65rem] text-foreground/78 sm:text-[1.95rem] lg:text-[2.2rem]",
											surface.className,
										)}
										key={surface.label}
									>
										{surface.label}
									</p>
								))}
							</div>
						</SectionCard>

						<div className="grid gap-6 border-t border-foreground/8 pt-6 md:grid-cols-3 md:gap-10">
							{operatingPoints.map((point) => (
								<motion.div className="px-2" key={point.title} variants={revealVariants}>
									<SectionLabel className="text-primary">{point.title}</SectionLabel>
									<p className="mt-4 max-w-[20rem] text-[0.98rem] leading-7 text-foreground/62">
										{point.description}
									</p>
								</motion.div>
							))}
						</div>
					</motion.div>
				</div>
			</section>

			<section className="mx-auto max-w-[1440px] px-6 py-24 md:px-8 lg:px-[112px] lg:py-32">
				<motion.div
					className="max-w-3xl"
					initial="hidden"
					variants={revealVariants}
					whileInView="show"
					viewport={inViewViewport}
				>
					<SectionLabel>A day with Amby</SectionLabel>
					<h2 className="headline-wrap mt-6 [font-family:var(--font-instrument)] text-5xl leading-[0.97] tracking-[-0.04em] text-foreground md:text-6xl">
						From first brief to clean shutdown.
					</h2>
					<p className="mt-5 max-w-2xl text-[1rem] leading-8 text-foreground/62">
						The point is not more notifications. It is having the right work prepared when you need
						it, then closed out before it drifts.
					</p>
				</motion.div>

				<motion.div
					className="relative mt-14 ml-4 border-l border-foreground/10 pl-7 lg:ml-0 lg:border-l-0 lg:pl-0"
					initial="hidden"
					variants={staggerVariants}
					whileInView="show"
					viewport={{ once: true, amount: 0.18 }}
				>
					<div className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-foreground/10 lg:block" />
					<div className="space-y-6 lg:space-y-9">
						{dayMoments.map((moment, index) => {
							const isRightAligned = index % 2 === 1

							return (
								<motion.div
									className="grid gap-4 lg:grid-cols-12 lg:items-start"
									key={moment.time}
									variants={revealVariants}
								>
									<div
										className={cn(
											"floating-label text-primary lg:col-span-2",
											isRightAligned && "lg:col-start-11 lg:text-right",
										)}
									>
										{moment.time}
									</div>
									<div
										className={cn(
											"relative rounded-[1.75rem] border border-foreground/8 bg-background-elevated p-5 sm:p-6 lg:col-span-5 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0",
											isRightAligned ? "lg:col-start-6" : "lg:col-start-3",
										)}
									>
										<div className="absolute -left-[1.82rem] top-7 size-2 rounded-full bg-primary lg:left-1/2 lg:top-4 lg:-translate-x-1/2" />
										<h3 className="[font-family:var(--font-instrument)] text-[2.3rem] leading-[1] tracking-[-0.03em] text-foreground lg:text-[2.55rem]">
											{moment.title}
										</h3>
										<p className="mt-3 max-w-[26rem] text-[0.98rem] leading-7 text-foreground/62">
											{moment.description}
										</p>
									</div>
								</motion.div>
							)
						})}
					</div>
				</motion.div>
			</section>

			<motion.section
				className="border-y border-foreground/8 bg-background-elevated py-20 lg:py-24"
				initial="hidden"
				variants={revealVariants}
				whileInView="show"
				viewport={inViewViewport}
			>
				<div className="mx-auto max-w-[1320px] px-6 md:px-8 lg:px-[112px]">
					<div className="grid gap-6 lg:grid-cols-[0.36fr,0.64fr] lg:items-start">
						<SectionLabel className="pt-1">Vision</SectionLabel>
						<div>
							<h2 className="headline-wrap [font-family:var(--font-instrument)] text-5xl leading-[0.97] tracking-[-0.04em] text-foreground md:text-6xl">
								From assistant app
								<br />
								to assistant computer.
							</h2>
							<p className="mt-5 max-w-2xl text-[1.03rem] leading-8 text-foreground/62">
								Like having a great assistant who has their own computer: one persistent workspace,
								clear permissions, and continuity that follows the work instead of restarting per
								app.
							</p>
							<div className="mt-7">
								<MarketingActionLink
									analyticsPlacement="home_vision_secondary"
									href="/vision"
									size="default"
									variant="secondary"
								>
									Read the full vision
								</MarketingActionLink>
							</div>
						</div>
					</div>
				</div>
			</motion.section>

			<section
				className="mx-auto max-w-[1440px] scroll-mt-36 px-6 py-[4.5rem] md:scroll-mt-32 md:px-8 lg:px-[112px] lg:py-24"
				id="access"
			>
				<motion.div
					className="relative overflow-hidden rounded-[3rem] border border-foreground/8 bg-panel-soft px-8 py-16 text-center md:px-12 lg:px-20 lg:py-[5.5rem]"
					initial="hidden"
					variants={revealVariants}
					whileInView="show"
					viewport={{ once: true, amount: 0.4 }}
				>
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(141,160,142,0.18),transparent_44%)]" />
					<div className="relative mx-auto max-w-3xl">
						<SectionLabel>Get access</SectionLabel>
						<h2 className="headline-wrap mt-6 [font-family:var(--font-instrument)] text-5xl leading-[0.95] tracking-[-0.045em] text-foreground md:text-7xl">
							Start reducing dropped balls.
						</h2>
						<p className="mx-auto mt-5 max-w-2xl text-[1.05rem] leading-8 text-foreground/62">
							Use Amby on Telegram today. See how the product works, then explore the codebase if
							you want a deeper look.
						</p>
						<div className="mt-9 flex flex-wrap justify-center gap-4">
							<motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.99 }}>
								<MarketingActionLink
									analyticsPlacement="home_access_primary"
									href={marketingLinks.telegram}
									rel="noreferrer"
									size="large"
									target="_blank"
								>
									<TelegramIcon className="size-3.5" />
									Open Telegram Bot
								</MarketingActionLink>
							</motion.div>
							<motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.99 }}>
								<MarketingActionLink
									analyticsPlacement="home_access_secondary"
									href={marketingLinks.github}
									rel="noreferrer"
									size="large"
									target="_blank"
									variant="secondary"
								>
									<GitHubIcon className="size-3.5" />
									Review the codebase
								</MarketingActionLink>
							</motion.div>
						</div>
						<div className="mt-8 flex flex-col items-center gap-1 text-sm text-foreground/54 sm:flex-row sm:justify-center sm:gap-8">
							<p>Telegram: @my_amby_bot</p>
							<p>GitHub: github.com/punitarani/amby</p>
						</div>
					</div>
				</motion.div>
			</section>
		</MarketingPageShell>
	)
}
