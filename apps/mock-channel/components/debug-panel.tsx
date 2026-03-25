"use client"

import { useState, useEffect } from "react"
import type { RequestLogEntry } from "../lib/telegram-types"
import { Bug, ChevronRight, ChevronDown } from "lucide-react"

export function DebugPanel() {
	const [entries, setEntries] = useState<RequestLogEntry[]>([])
	const [expanded, setExpanded] = useState<Set<string>>(new Set())

	// Poll for request log updates
	useEffect(() => {
		const poll = async () => {
			try {
				const res = await fetch("/api/state")
				const data = await res.json()
				setEntries(data.requestLog ?? [])
			} catch {
				/* ignore */
			}
		}

		poll()
		const interval = setInterval(poll, 2000)
		return () => clearInterval(interval)
	}, [])

	const toggleExpand = (id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	return (
		<div className="flex h-full flex-col border-l border-neutral-800">
			<div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
				<Bug size={14} className="text-neutral-400" />
				<span className="text-xs font-medium text-neutral-300">
					Debug Log
				</span>
				<span className="text-[10px] text-neutral-600">
					{entries.length} entries
				</span>
			</div>
			<div className="flex-1 overflow-y-auto text-xs">
				{entries.length === 0 && (
					<div className="p-3 text-neutral-600">No requests yet</div>
				)}
				{[...entries].reverse().map((entry) => (
					<div key={entry.id} className="border-b border-neutral-800/50">
						<button
							onClick={() => toggleExpand(entry.id)}
							className="flex w-full items-start gap-1 px-3 py-2 text-left hover:bg-neutral-800/30"
						>
							{expanded.has(entry.id) ? (
								<ChevronDown
									size={12}
									className="mt-0.5 shrink-0 text-neutral-500"
								/>
							) : (
								<ChevronRight
									size={12}
									className="mt-0.5 shrink-0 text-neutral-500"
								/>
							)}
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span
										className={`font-mono text-[10px] ${
											entry.direction === "inbound"
												? "text-green-400"
												: "text-blue-400"
										}`}
									>
										{entry.direction === "inbound"
											? "-> WEBHOOK"
											: "<- BOT API"}
									</span>
									<span className="text-neutral-500">
										{new Date(entry.timestamp).toLocaleTimeString()}
									</span>
								</div>
								<div className="mt-0.5 truncate text-neutral-400 font-mono">
									{entry.method}{" "}
									{entry.url.split("/").slice(-2).join("/")}
								</div>
							</div>
						</button>
						{expanded.has(entry.id) && (
							<div className="bg-neutral-900 px-3 py-2">
								<div className="mb-1 text-[10px] text-neutral-500">
									Request Body
								</div>
								<pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-neutral-300 font-mono">
									{JSON.stringify(entry.body, null, 2)}
								</pre>
								{entry.response && (
									<>
										<div className="mt-2 mb-1 text-[10px] text-neutral-500">
											Response ({entry.response.status})
										</div>
										<pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-neutral-300 font-mono">
											{typeof entry.response.body === "string"
												? entry.response.body.slice(0, 500)
												: JSON.stringify(
														entry.response.body,
														null,
														2,
													)}
										</pre>
									</>
								)}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	)
}
