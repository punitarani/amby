"use client"

import type { TelegramWidgetAuthData } from "@amby/auth"
import { useState } from "react"
import { createMockAuthClient } from "../lib/auth-client"
import type { MockUserConfig } from "../lib/telegram-types"

type AuthResultState = {
	label: string
	payload: unknown
} | null

export function TelegramAuthPanel({ user }: { user: MockUserConfig }) {
	const authClient = createMockAuthClient(user.backendUrl)
	const [result, setResult] = useState<AuthResultState>(null)
	const [pending, setPending] = useState<string | null>(null)

	const run = async (label: string, action: () => Promise<unknown>) => {
		setPending(label)
		try {
			const payload = await action()
			setResult({ label, payload })
		} catch (error) {
			setResult({
				label,
				payload: {
					error: error instanceof Error ? error.message : String(error),
				},
			})
		} finally {
			setPending(null)
		}
	}

	const fetchMockPayload = async () => {
		const response = await fetch("/api/telegram-auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ user }),
		})
		if (!response.ok) {
			throw new Error(await response.text())
		}
		return (await response.json()) as {
			widgetAuthData: TelegramWidgetAuthData
			miniAppInitData: string
		}
	}

	const getSession = async () => {
		const response = await fetch(`${user.backendUrl}/api/auth/get-session`, {
			credentials: "include",
		})
		return response.json()
	}

	return (
		<section className="border-b border-neutral-800 bg-neutral-950/90 px-4 py-3">
			<div className="mb-3 flex items-center justify-between">
				<div>
					<h2 className="font-medium text-sm text-neutral-100">Telegram Auth</h2>
					<p className="text-neutral-500 text-xs">
						Calls the first-party Better Auth Telegram plugin on {user.backendUrl}.
					</p>
				</div>
				<div className="text-[11px] text-neutral-500">
					{pending ? `Running ${pending}...` : "Ready"}
				</div>
			</div>
			<div className="mb-3 flex flex-wrap gap-2">
				<button
					type="button"
					onClick={() =>
						run("widget-signin", async () => {
							const payload = await fetchMockPayload()
							return authClient.signInWithTelegram(payload.widgetAuthData)
						})
					}
					className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500"
				>
					Mock widget sign-in
				</button>
				<button
					type="button"
					onClick={() =>
						run("widget-link", async () => {
							const payload = await fetchMockPayload()
							return authClient.linkTelegram(payload.widgetAuthData)
						})
					}
					className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500"
				>
					Mock widget link
				</button>
				<button
					type="button"
					onClick={() =>
						run("miniapp-validate", async () => {
							const payload = await fetchMockPayload()
							return authClient.validateMiniApp(payload.miniAppInitData)
						})
					}
					className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500"
				>
					Mock miniapp validate
				</button>
				<button
					type="button"
					onClick={() =>
						run("miniapp-signin", async () => {
							const payload = await fetchMockPayload()
							return authClient.signInWithMiniApp(payload.miniAppInitData)
						})
					}
					className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500"
				>
					Mock miniapp sign-in
				</button>
				<button
					type="button"
					onClick={() => run("unlink", async () => authClient.unlinkTelegram())}
					className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500"
				>
					Unlink Telegram
				</button>
				<button
					type="button"
					onClick={() => run("session", async () => getSession())}
					className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500"
				>
					Get session
				</button>
				<button
					type="button"
					onClick={() =>
						run("oidc-start", async () =>
							authClient.signInWithTelegramOIDC({
								callbackURL: `${window.location.origin}`,
								disableRedirect: true,
							}),
						)
					}
					className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500"
				>
					OIDC start
				</button>
			</div>
			<div className="overflow-auto rounded border border-neutral-800 bg-neutral-900 p-3">
				<div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-neutral-500">
					{result?.label ?? "last result"}
				</div>
				<pre className="whitespace-pre-wrap break-words text-[11px] text-neutral-200">
					{JSON.stringify(result?.payload ?? { status: "No auth action run yet" }, null, 2)}
				</pre>
			</div>
		</section>
	)
}
