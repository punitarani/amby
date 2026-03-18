import type { Metadata } from "next"

import { MarketingActionLink } from "@/components/marketing/action-link"
import { marketingLinks } from "@/components/marketing/constants"
import { DreamyImageCard } from "@/components/marketing/dreamy-image-card"
import { MarketingPageShell } from "@/components/marketing/page-shell"
import { SectionLabel } from "@/components/marketing/section-label"
import { GitHubIcon } from "@/components/marketing/social-icons"

const githubReasons = [
	{
		copy: "See the clearest articulation of Amby as a personal assistant computer, not just a chat surface.",
		label: "Product direction",
	},
	{
		copy: "Track how the cloud runtime, workflow surfaces, and operating model are evolving in public.",
		label: "Implementation progress",
	},
	{
		copy: "Review architecture choices, technical depth, and the tradeoffs behind how continuity is being built.",
		label: "Technical depth",
	},
] as const

const repoAreas = [
	"Core product framing and mission documents.",
	"Implementation across the web app, API, and assistant surfaces.",
	"The current direction for trust, review, and continuity.",
] as const

export const metadata: Metadata = {
	alternates: {
		canonical: "/github",
	},
	description:
		"Explore the open-source repo behind Amby and see the product direction, architecture, and implementation in one place.",
	title: "GitHub | AMBY",
}

export default function GitHubPage() {
	return (
		<MarketingPageShell>
			<section className="mx-auto max-w-[1440px] px-6 pb-18 pt-8 md:px-8 lg:px-[112px] lg:pb-24 lg:pt-16">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,0.96fr)_minmax(22rem,1.04fr)] lg:items-center lg:gap-14">
					<div className="max-w-[38rem]">
						<SectionLabel className="text-primary">GitHub</SectionLabel>
						<h1 className="headline-wrap mt-7 [font-family:var(--font-instrument)] text-[clamp(3.7rem,8vw,6rem)] leading-[0.92] tracking-[-0.05em] text-foreground">
							Build with
							<br />
							Amby in
							<br />
							the open.
						</h1>
						<p className="mt-7 max-w-2xl text-[1.08rem] leading-8 text-foreground/64">
							The repo is the best place to understand where Amby is going. It keeps the product
							direction, architecture, and implementation in one visible thread.
						</p>
						<div className="mt-8 flex flex-wrap gap-4">
							<MarketingActionLink
								analyticsPlacement="github_hero_primary"
								href={marketingLinks.github}
								rel="noreferrer"
								size="large"
								target="_blank"
							>
								<GitHubIcon className="size-3.5" />
								Review the codebase
							</MarketingActionLink>
							<MarketingActionLink
								analyticsPlacement="github_hero_secondary"
								href="/vision"
								size="large"
								variant="secondary"
							>
								Read the vision
							</MarketingActionLink>
						</div>
						<p className="mt-7 max-w-xl text-[0.98rem] leading-7 text-foreground/56">
							Open progress matters here because Amby is making a trust-heavy promise. Public work
							makes the product easier to evaluate.
						</p>
					</div>

					<div className="space-y-5">
						<div className="marketing-card p-4">
							<DreamyImageCard
								alt="Dreamy visual paired with open-source access to Amby"
								className="aspect-[6/5] rounded-[2rem]"
								priority
								sizes="(min-width: 1024px) 40rem, 100vw"
								src="/images/dreamy-flow-landscape.png"
							/>
						</div>
						<div className="marketing-card p-6">
							<SectionLabel className="text-primary">Why this page exists</SectionLabel>
							<p className="mt-4 text-[1rem] leading-7 text-foreground/62">
								Public progress builds trust. It shows how the product is being shaped, what exists
								today, and how the assistant is meant to evolve over time.
							</p>
						</div>
					</div>
				</div>
			</section>

			<section className="section-band border-y border-foreground/8 py-20 lg:py-24">
				<div className="mx-auto max-w-[1440px] px-6 md:px-8 lg:px-[112px]">
					<div className="max-w-3xl">
						<SectionLabel>Why open source matters here</SectionLabel>
						<h2 className="headline-wrap mt-5 [font-family:var(--font-instrument)] text-5xl leading-[0.97] tracking-[-0.045em] text-foreground md:text-6xl">
							The product promise is easier to believe when the work is visible.
						</h2>
					</div>
					<div className="mt-8 grid gap-4 md:grid-cols-3">
						{githubReasons.map((reason) => (
							<article className="marketing-card p-6 sm:p-7" key={reason.label}>
								<SectionLabel className="text-primary">{reason.label}</SectionLabel>
								<p className="mt-4 text-[1rem] leading-7 text-foreground/62">{reason.copy}</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-[1440px] px-6 py-20 md:px-8 lg:px-[112px] lg:py-24">
				<div className="grid gap-6 lg:grid-cols-[minmax(0,1.06fr)_minmax(18rem,0.94fr)]">
					<div className="marketing-card px-8 py-12 sm:px-10">
						<SectionLabel className="text-primary">What you'll find</SectionLabel>
						<h2 className="headline-wrap mt-5 max-w-[10ch] [font-family:var(--font-instrument)] text-5xl leading-[0.97] tracking-[-0.045em] text-foreground md:text-6xl">
							The product story and the implementation in one place.
						</h2>
						<div className="mt-7 space-y-4">
							{repoAreas.map((area) => (
								<p
									className="border-t border-foreground/8 pt-4 text-[1rem] leading-7 text-foreground/62"
									key={area}
								>
									{area}
								</p>
							))}
						</div>
					</div>

					<div className="marketing-card px-8 py-12 text-center sm:px-10">
						<SectionLabel className="text-primary">Ready to dig in</SectionLabel>
						<h2 className="headline-wrap mt-5 [font-family:var(--font-instrument)] text-4xl leading-[0.98] tracking-[-0.04em] text-foreground sm:text-5xl">
							Start with the repo.
						</h2>
						<p className="mx-auto mt-4 max-w-sm text-[1rem] leading-7 text-foreground/62">
							If you want the clearest picture of what Amby is and how it is being built, begin on
							GitHub.
						</p>
						<div className="mt-7">
							<MarketingActionLink
								analyticsPlacement="github_final_primary"
								href={marketingLinks.github}
								rel="noreferrer"
								size="large"
								target="_blank"
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
