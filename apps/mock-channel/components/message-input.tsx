"use client"

import { useState, useCallback, type KeyboardEvent } from "react"
import { Send } from "lucide-react"

export function MessageInput({
	onSend,
	disabled,
}: {
	onSend: (text: string) => void
	disabled?: boolean
}) {
	const [text, setText] = useState("")

	const handleSend = useCallback(() => {
		const trimmed = text.trim()
		if (!trimmed || disabled) return
		onSend(trimmed)
		setText("")
	}, [text, disabled, onSend])

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				handleSend()
			}
		},
		[handleSend],
	)

	return (
		<div className="border-t border-neutral-800 p-4">
			<div className="flex items-end gap-2">
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Type a message..."
					disabled={disabled}
					rows={1}
					className="flex-1 resize-none rounded-xl bg-neutral-800 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
				/>
				<button
					onClick={handleSend}
					disabled={disabled || !text.trim()}
					className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600"
				>
					<Send size={18} />
				</button>
			</div>
		</div>
	)
}
