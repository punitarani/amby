"use client"

import { useEffect, useRef } from "react"
import type { StoredMessage } from "../lib/telegram-types"
import { MessageBubble } from "./message-bubble"

export function MessageList({
	messages,
	isTyping,
}: {
	messages: StoredMessage[]
	isTyping: boolean
}) {
	const bottomRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [messages.length, isTyping])

	return (
		<div className="flex-1 overflow-y-auto px-4 py-4">
			{messages.length === 0 && (
				<div className="flex h-full items-center justify-center text-neutral-500 text-sm">
					Send a message to start the conversation
				</div>
			)}
			{messages.map((msg) => (
				<MessageBubble key={`${msg.message_id}-${msg.text.slice(0, 20)}`} message={msg} />
			))}
			{isTyping && (
				<div className="flex justify-start mb-2">
					<div className="bg-neutral-800 rounded-2xl rounded-bl-sm px-4 py-2 text-sm text-neutral-400">
						<span className="animate-pulse">typing...</span>
					</div>
				</div>
			)}
			<div ref={bottomRef} />
		</div>
	)
}
