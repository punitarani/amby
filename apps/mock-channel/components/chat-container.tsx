"use client"

import { useState, useEffect, useCallback } from "react"
import type { MockUserConfig, DisplayMessage } from "../lib/telegram-types"
import { MessageList } from "./message-list"
import { MessageInput } from "./message-input"

export function ChatContainer({ user }: { user: MockUserConfig }) {
	const [messages, setMessages] = useState<DisplayMessage[]>([])
	const [sending, setSending] = useState(false)

	// Poll for messages and also listen to SSE
	useEffect(() => {
		const fetchMessages = async () => {
			try {
				const res = await fetch("/api/state")
				const data = await res.json()
				setMessages(data.messages ?? [])
			} catch {
				/* ignore */
			}
		}

		fetchMessages()

		// SSE for real-time updates
		const eventSource = new EventSource("/api/sse")
		eventSource.onmessage = (event) => {
			try {
				const parsed = JSON.parse(event.data)
				if (parsed.event === "message") {
					fetchMessages()
				}
			} catch {
				/* ignore */
			}
		}

		// Fallback polling
		const interval = setInterval(fetchMessages, 3000)

		return () => {
			eventSource.close()
			clearInterval(interval)
		}
	}, [])

	const handleSend = useCallback(
		async (text: string) => {
			setSending(true)
			try {
				const res = await fetch("/api/send", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text, user }),
				})
				if (res.ok) {
					const data = await res.json()
					setMessages(data.messages ?? [])
				}
			} catch {
				/* ignore */
			} finally {
				setSending(false)
			}
		},
		[user],
	)

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<MessageList messages={messages} />
			<MessageInput onSend={handleSend} disabled={sending} />
		</div>
	)
}
