"use client"

import { Fragment, type ReactNode, useEffect, useState } from "react"
import type { DisplayMessage } from "../lib/telegram-types"

function renderTelegramHtml(html: string): ReactNode {
	const parser = new DOMParser()
	const document = parser.parseFromString(`<body>${html}</body>`, "text/html")
	return renderNodes(Array.from(document.body.childNodes))
}

function renderNodes(nodes: ChildNode[]): ReactNode[] {
	return nodes.map((node, index) => renderNode(node, index))
}

function renderNode(node: ChildNode, key: number): ReactNode {
	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent
	}

	if (node.nodeType !== Node.ELEMENT_NODE) {
		return null
	}

	const element = node as HTMLElement
	const tag = element.tagName.toLowerCase()
	const children = renderNodes(Array.from(element.childNodes))

	switch (tag) {
		case "b":
		case "strong":
			return <strong key={key}>{children}</strong>
		case "i":
		case "em":
			return <em key={key}>{children}</em>
		case "s":
		case "strike":
		case "del":
			return <s key={key}>{children}</s>
		case "code":
			return (
				<code key={key} className="rounded bg-neutral-900 px-1">
					{children}
				</code>
			)
		case "pre":
			return (
				<pre key={key} className="overflow-x-auto rounded bg-neutral-900 p-3">
					{children}
				</pre>
			)
		case "blockquote":
			return (
				<blockquote key={key} className="border-l border-neutral-600 pl-3">
					{children}
				</blockquote>
			)
		case "a": {
			const href = element.getAttribute("href") ?? undefined
			return (
				<a key={key} href={href} target="_blank" rel="noreferrer" className="underline">
					{children}
				</a>
			)
		}
		default:
			return <Fragment key={key}>{children}</Fragment>
	}
}

export function MessageBubble({ message }: { message: DisplayMessage }) {
	const isUser = message.role === "user"
	const [isClient, setIsClient] = useState(false)

	useEffect(() => {
		setIsClient(true)
	}, [])

	return (
		<div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
			<div
				className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
					isUser ? "bg-blue-600 text-white" : "bg-neutral-800 text-neutral-200"
				}`}
			>
				{message.parseMode === "HTML" && !isUser && isClient ? (
					<div className="whitespace-pre-wrap break-words">{renderTelegramHtml(message.text)}</div>
				) : (
					<p className="whitespace-pre-wrap break-words">{message.text}</p>
				)}
				<div className={`mt-1 text-[10px] ${isUser ? "text-blue-200" : "text-neutral-500"}`}>
					{new Date(message.timestamp).toLocaleTimeString()}
				</div>
			</div>
		</div>
	)
}
