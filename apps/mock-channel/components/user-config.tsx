"use client"

import { useState, useEffect, useCallback } from "react"
import type { MockUserConfig } from "../lib/telegram-types"
import { Settings, RotateCcw } from "lucide-react"

const STORAGE_KEY = "mock-channel-user-config"

const DEFAULT_CONFIG: MockUserConfig = {
	telegramUserId: 99001,
	firstName: "Dev",
	lastName: "Tester",
	username: "devtester",
	chatId: 99001,
	backendUrl: "http://localhost:3001",
	webhookSecret: "dev-secret",
}

export function useUserConfig() {
	const [config, setConfig] = useState<MockUserConfig>(DEFAULT_CONFIG)
	const [loaded, setLoaded] = useState(false)

	useEffect(() => {
		const stored = localStorage.getItem(STORAGE_KEY)
		if (stored) {
			try {
				setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(stored) })
			} catch {
				/* use defaults */
			}
		}
		setLoaded(true)
	}, [])

	const updateConfig = useCallback((updates: Partial<MockUserConfig>) => {
		setConfig((prev) => {
			const next = { ...prev, ...updates }
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
			return next
		})
	}, [])

	const resetConfig = useCallback(() => {
		localStorage.removeItem(STORAGE_KEY)
		setConfig(DEFAULT_CONFIG)
	}, [])

	return { config, updateConfig, resetConfig, loaded }
}

export function UserConfigPanel({
	config,
	onUpdate,
	onReset,
	onClear,
}: {
	config: MockUserConfig
	onUpdate: (updates: Partial<MockUserConfig>) => void
	onReset: () => void
	onClear: () => void
}) {
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="border-b border-neutral-800">
			<div className="flex items-center justify-between px-4 py-2">
				<div className="flex items-center gap-2 text-sm">
					<span className="font-medium">{config.firstName}</span>
					<span className="text-neutral-500">@{config.username}</span>
					<span className="text-neutral-600">chat:{config.chatId}</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={onClear}
						className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
						title="Clear conversation"
					>
						<RotateCcw size={14} />
					</button>
					<button
						onClick={() => setExpanded(!expanded)}
						className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
						title="Settings"
					>
						<Settings size={14} />
					</button>
				</div>
			</div>
			{expanded && (
				<div className="border-t border-neutral-800 px-4 py-3 space-y-2">
					<div className="grid grid-cols-2 gap-2">
						<label className="text-xs text-neutral-400">
							User ID
							<input
								type="number"
								value={config.telegramUserId}
								onChange={(e) =>
									onUpdate({ telegramUserId: Number(e.target.value) })
								}
								className="mt-1 block w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
							/>
						</label>
						<label className="text-xs text-neutral-400">
							Chat ID
							<input
								type="number"
								value={config.chatId}
								onChange={(e) =>
									onUpdate({ chatId: Number(e.target.value) })
								}
								className="mt-1 block w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
							/>
						</label>
						<label className="text-xs text-neutral-400">
							First Name
							<input
								type="text"
								value={config.firstName}
								onChange={(e) => onUpdate({ firstName: e.target.value })}
								className="mt-1 block w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
							/>
						</label>
						<label className="text-xs text-neutral-400">
							Username
							<input
								type="text"
								value={config.username ?? ""}
								onChange={(e) => onUpdate({ username: e.target.value })}
								className="mt-1 block w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
							/>
						</label>
					</div>
					<label className="text-xs text-neutral-400 block">
						Backend URL
						<input
							type="text"
							value={config.backendUrl}
							onChange={(e) => onUpdate({ backendUrl: e.target.value })}
							className="mt-1 block w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
						/>
					</label>
					<label className="text-xs text-neutral-400 block">
						Webhook Secret
						<input
							type="text"
							value={config.webhookSecret}
							onChange={(e) => onUpdate({ webhookSecret: e.target.value })}
							className="mt-1 block w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 font-mono"
						/>
					</label>
					<button
						onClick={onReset}
						className="text-xs text-red-400 hover:text-red-300"
					>
						Reset to defaults
					</button>
				</div>
			)}
		</div>
	)
}
