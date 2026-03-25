"use client"

import { useEffect, useRef } from "react"
import type { DisplayMessage } from "../lib/telegram-types"
import { MessageBubble } from "./message-bubble"

export function MessageList({ messages }: { messages: DisplayMessage[] }) {
	const bottomRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [messages])

	return (
		<div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
			{messages.length === 0 && (
				<div className="flex h-full items-center justify-center text-sm text-neutral-600">
					Send a message to start the conversation
				</div>
			)}
			{messages.map((msg) => (
				<MessageBubble key={msg.id} message={msg} />
			))}
			<div ref={bottomRef} />
		</div>
	)
}
