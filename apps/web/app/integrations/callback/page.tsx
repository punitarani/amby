import Link from "next/link"
import { buildTelegramStartUrl, normalizeTelegramBotUsername } from "@/lib/telegram"

// Derived from @amby/connectors TOOLKIT_REGISTRY — update when adding a new toolkit
const INTEGRATION_LABELS: Record<string, string> = {
	gmail: "Gmail",
	googlecalendar: "Google Calendar",
	notion: "Notion",
	slack: "Slack",
	googledrive: "Google Drive",
}

type SearchParams = Record<string, string | string[] | undefined>

type IntegrationCallbackPageProps = {
	searchParams?: Promise<SearchParams> | SearchParams
}

const getFirstParam = (value: string | string[] | undefined) =>
	Array.isArray(value) ? value[0] : value

export default async function IntegrationCallbackPage({
	searchParams,
}: IntegrationCallbackPageProps) {
	const params = await Promise.resolve(searchParams ?? {})
	const toolkit = getFirstParam(params.toolkit)
	const label = (toolkit && INTEGRATION_LABELS[toolkit]) || "your app"
	const telegramUsername = normalizeTelegramBotUsername(
		process.env.TELEGRAM_BOT_USERNAME ?? process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
	)
	const telegramUrl = buildTelegramStartUrl(
		toolkit ? `connect-${toolkit}` : undefined,
		telegramUsername,
	)

	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(207,232,205,0.34),transparent_40%),linear-gradient(180deg,#f8f7ef_0%,#f3f0e1_100%)] px-6 py-12 text-stone-900">
			<div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-3xl items-center justify-center">
				<div className="w-full rounded-[2rem] border border-stone-900/8 bg-white/88 p-8 shadow-[0_22px_80px_-42px_rgba(61,72,61,0.42)] backdrop-blur md:p-12">
					<p className="text-sm uppercase tracking-[0.28em] text-stone-500">Connection ready</p>
					<h1 className="mt-4 text-4xl leading-tight tracking-[-0.04em] text-stone-900 md:text-5xl">
						Head back to Telegram.
					</h1>
					<p className="mt-5 max-w-2xl text-base leading-8 text-stone-700/85 md:text-lg">
						{label} authorization finished. Return to Telegram and Amby will verify the connection
						and pick up from there.
					</p>
					<div className="mt-8 flex flex-wrap gap-4">
						<Link
							className="inline-flex items-center justify-center rounded-full bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800"
							href={telegramUrl}
						>
							Back to Telegram
						</Link>
						<Link
							className="inline-flex items-center justify-center rounded-full border border-stone-900/12 px-6 py-3 text-sm font-medium text-stone-700 transition hover:bg-stone-900/4"
							href="/"
						>
							Open site
						</Link>
					</div>
					<p className="mt-6 text-sm leading-7 text-stone-500">
						If Telegram does not reopen automatically, tap the button above or send{" "}
						<span className="font-medium text-stone-700">/start</span> in the bot chat.
					</p>
				</div>
			</div>
		</main>
	)
}
