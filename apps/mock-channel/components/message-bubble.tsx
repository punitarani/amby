"use client"

import type { StoredMessage } from "../lib/telegram-types"

export function MessageBubble({ message }: { message: StoredMessage }) {
	const isUser = !message.from_bot
	return (
		<div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}>
			<div
				className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
					isUser
						? "bg-blue-600 text-white rounded-br-sm"
						: "bg-neutral-800 text-neutral-100 rounded-bl-sm"
				} ${message.edited ? "border border-neutral-600" : ""}`}
			>
				{message.text}
				{message.edited && (
					<span className="ml-2 text-[10px] opacity-50">(edited)</span>
				)}
			</div>
		</div>
	)
}
