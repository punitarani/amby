"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { StoredMessage, MockUserConfig } from "../lib/telegram-types"
import { MessageList } from "./message-list"
import { MessageInput } from "./message-input"

export function ChatContainer({ user }: { user: MockUserConfig }) {
	const [messages, setMessages] = useState<StoredMessage[]>([])
	const [isTyping, setIsTyping] = useState(false)
	const [isSending, setIsSending] = useState(false)
	const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)

	// Subscribe to SSE events
	useEffect(() => {
		const eventSource = new EventSource("/api/events")

		eventSource.addEventListener("message", (e) => {
			const msg: StoredMessage = JSON.parse(e.data)
			setMessages((prev) => {
				// Avoid duplicates
				if (prev.some((m) => m.message_id === msg.message_id)) return prev
				return [...prev, msg]
			})
			setIsTyping(false)
		})

		eventSource.addEventListener("edit", (e) => {
			const edited: StoredMessage = JSON.parse(e.data)
			setMessages((prev) =>
				prev.map((m) => (m.message_id === edited.message_id ? edited : m)),
			)
		})

		eventSource.addEventListener("delete", (e) => {
			const { message_id } = JSON.parse(e.data) as { message_id: number }
			setMessages((prev) => prev.filter((m) => m.message_id !== message_id))
		})

		eventSource.addEventListener("typing", () => {
			setIsTyping(true)
			if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
			typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 6000)
		})

		eventSource.addEventListener("clear", () => {
			setMessages([])
			setIsTyping(false)
		})

		return () => {
			eventSource.close()
			if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
		}
	}, [])

	const handleSend = useCallback(
		async (text: string) => {
			setIsSending(true)

			// Optimistically add user message
			const optimisticMsg: StoredMessage = {
				message_id: -(Date.now()),
				chat_id: user.chatId,
				text,
				from_bot: false,
				date: Math.floor(Date.now() / 1000),
			}
			setMessages((prev) => [...prev, optimisticMsg])

			try {
				const response = await fetch("/api/send", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text, user }),
				})

				if (!response.ok) {
					const error = await response.json()
					console.error("Send failed:", error)
				}
			} catch (error) {
				console.error("Send error:", error)
			} finally {
				setIsSending(false)
			}
		},
		[user],
	)

	return (
		<div className="flex h-full flex-col">
			<MessageList messages={messages} isTyping={isTyping} />
			<MessageInput onSend={handleSend} disabled={isSending} />
		</div>
	)
}
