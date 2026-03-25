"use client"

import type { DisplayMessage } from "../lib/telegram-types"

export function MessageBubble({ message }: { message: DisplayMessage }) {
	const isUser = message.role === "user"

	return (
		<div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
			<div
				className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
					isUser
						? "bg-blue-600 text-white"
						: "bg-neutral-800 text-neutral-200"
				}`}
			>
				<p className="whitespace-pre-wrap break-words">{message.text}</p>
				<div
					className={`mt-1 text-[10px] ${
						isUser ? "text-blue-200" : "text-neutral-500"
					}`}
				>
					{new Date(message.timestamp).toLocaleTimeString()}
				</div>
			</div>
		</div>
	)
}
