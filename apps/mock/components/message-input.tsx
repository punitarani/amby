"use client"

import { Send } from "lucide-react"
import { useCallback, useState } from "react"

export function MessageInput({
	onSend,
	disabled,
}: {
	onSend: (text: string) => void
	disabled?: boolean
}) {
	const [text, setText] = useState("")

	const handleSubmit = useCallback(() => {
		const trimmed = text.trim()
		if (!trimmed || disabled) return
		onSend(trimmed)
		setText("")
	}, [text, disabled, onSend])

	return (
		<div className="border-t border-neutral-800 px-4 py-3">
			<div className="flex items-end gap-2">
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault()
							handleSubmit()
						}
					}}
					placeholder="Type a message..."
					rows={1}
					disabled={disabled}
					className="flex-1 resize-none rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-50"
				/>
				<button
					type="button"
					onClick={handleSubmit}
					disabled={disabled || !text.trim()}
					className="rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600"
				>
					<Send size={16} />
				</button>
			</div>
		</div>
	)
}
