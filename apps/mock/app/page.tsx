"use client"

import { PanelRightClose, PanelRightOpen } from "lucide-react"
import { useState } from "react"
import { ChatContainer } from "../components/chat-container"
import { DebugPanel } from "../components/debug-panel"
import { TelegramAuthPanel } from "../components/telegram-auth-panel"
import { UserConfigPanel, useUserConfig } from "../components/user-config"

export default function Home() {
	const { config, updateConfig, resetConfig, loaded } = useUserConfig()
	const [showDebug, setShowDebug] = useState(true)

	const handleClear = async () => {
		await fetch("/api/clear", { method: "POST" })
	}

	if (!loaded) {
		return (
			<main className="flex h-screen items-center justify-center">
				<div className="text-neutral-500 text-sm">Loading...</div>
			</main>
		)
	}

	return (
		<main className="flex h-screen">
			{/* Chat area */}
			<div className={`flex flex-col ${showDebug ? "w-[65%]" : "w-full"}`}>
				<UserConfigPanel
					config={config}
					onUpdate={updateConfig}
					onReset={resetConfig}
					onClear={handleClear}
				/>
				<TelegramAuthPanel user={config} />
				<ChatContainer user={config} />
			</div>

			{/* Debug toggle */}
			<button
				type="button"
				onClick={() => setShowDebug(!showDebug)}
				className="absolute right-2 top-2 z-10 rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
				title={showDebug ? "Hide debug panel" : "Show debug panel"}
			>
				{showDebug ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
			</button>

			{/* Debug panel */}
			{showDebug && (
				<div className="w-[35%]">
					<DebugPanel />
				</div>
			)}
		</main>
	)
}
