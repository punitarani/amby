import type { AdapterPostableMessage, PostableAst, PostableMarkdown, PostableRaw, Root } from "chat"
import {
	isBlockquoteNode,
	isCodeNode,
	isDeleteNode,
	isEmphasisNode,
	isInlineCodeNode,
	isLinkNode,
	isListItemNode,
	isListNode,
	isParagraphNode,
	isStrongNode,
	isTableNode,
	isTextNode,
	parseMarkdown,
	tableToAscii,
} from "chat"

const TELEGRAM_HTML_PARSE_MODE = "HTML"
const TELEGRAM_HTML_ALLOWED_TAGS = new Set([
	"a",
	"b",
	"blockquote",
	"code",
	"del",
	"em",
	"i",
	"ins",
	"pre",
	"s",
	"strike",
	"strong",
	"u",
])

type HtmlToken =
	| {
			kind: "tag"
			raw: string
			tagName?: string
			isClosing?: boolean
			isSelfClosing?: boolean
	  }
	| {
			kind: "text"
			raw: string
			visibleLength: number
	  }

type OpenTag = {
	name: string
	openTag: string
}

export type TelegramRichTextPostable = PostableRaw

export function telegramHtml(html: string): TelegramRichTextPostable {
	return { raw: html }
}

export function isTelegramRichTextMessage(
	message: AdapterPostableMessage,
): message is TelegramRichTextPostable | PostableMarkdown | PostableAst {
	if (typeof message !== "object" || message === null) return false
	if ("card" in message) return false
	return (
		("raw" in message && typeof message.raw === "string") ||
		("markdown" in message && typeof message.markdown === "string") ||
		("ast" in message && typeof message.ast === "object" && message.ast !== null)
	)
}

export function getTelegramRichTextHtml(
	message: TelegramRichTextPostable | PostableMarkdown | PostableAst,
) {
	if ("raw" in message) return message.raw
	if ("markdown" in message) return renderTelegramHtmlFromMarkdown(message.markdown)
	return renderTelegramHtmlFromAst(message.ast)
}

export function escapeTelegramHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeTelegramHtmlAttribute(text: string): string {
	return escapeTelegramHtml(text).replaceAll('"', "&quot;")
}

export function renderTelegramHtmlFromMarkdown(markdown: string): string {
	return renderTelegramHtmlFromAst(parseMarkdown(markdown))
}

export function renderTelegramHtmlFromAst(ast: Root): string {
	return renderBlockNodes(ast.children, 0)
}

function renderBlockNodes(nodes: Root["children"], listDepth: number): string {
	return nodes
		.map((node) => renderBlockNode(node, listDepth))
		.filter((node): node is string => node.trim().length > 0)
		.join("\n\n")
}

function renderBlockNode(node: Root["children"][number], listDepth: number): string {
	if (isParagraphNode(node)) {
		return renderInlineNodes(node.children)
	}

	if (isListNode(node)) {
		return renderList(node, listDepth)
	}

	if (isBlockquoteNode(node)) {
		const content = renderBlockNodes(node.children, listDepth)
		return content ? `<blockquote>${content}</blockquote>` : ""
	}

	if (isCodeNode(node)) {
		const escaped = escapeTelegramHtml(node.value)
		if (node.lang) {
			return `<pre><code class="language-${escapeTelegramHtmlAttribute(node.lang)}">${escaped}</code></pre>`
		}
		return `<pre>${escaped}</pre>`
	}

	if (isTableNode(node)) {
		return `<pre>${escapeTelegramHtml(tableToAscii(node))}</pre>`
	}

	if ("children" in node && Array.isArray(node.children)) {
		return renderBlockNodes(node.children as Root["children"], listDepth)
	}

	return ""
}

function renderInlineNodes(
	nodes: Array<
		| Root["children"][number]
		| Extract<Root["children"][number], { children: unknown[] }>["children"][number]
	>,
): string {
	return nodes.map((node) => renderInlineNode(node)).join("")
}

function renderInlineNode(
	node:
		| Root["children"][number]
		| Extract<Root["children"][number], { children: unknown[] }>["children"][number],
): string {
	if (isTextNode(node)) {
		return escapeTelegramHtml(node.value)
	}

	if (isStrongNode(node)) {
		return `<b>${renderInlineNodes(node.children)}</b>`
	}

	if (isEmphasisNode(node)) {
		return `<i>${renderInlineNodes(node.children)}</i>`
	}

	if (isDeleteNode(node)) {
		return `<s>${renderInlineNodes(node.children)}</s>`
	}

	if (isInlineCodeNode(node)) {
		return `<code>${escapeTelegramHtml(node.value)}</code>`
	}

	if (isLinkNode(node)) {
		return `<a href="${escapeTelegramHtmlAttribute(node.url)}">${renderInlineNodes(node.children)}</a>`
	}

	if ("type" in node && node.type === "break") {
		return "\n"
	}

	if ("children" in node && Array.isArray(node.children)) {
		return renderInlineNodes(node.children)
	}

	return ""
}

function renderList(
	node: Extract<Root["children"][number], { type: "list" }>,
	listDepth: number,
): string {
	return node.children
		.filter(isListItemNode)
		.map((item, index) => renderListItem(item, listDepth, node.ordered, index))
		.join("\n")
}

function renderListItem(
	item: Extract<Root["children"][number], { type: "listItem" }>,
	listDepth: number,
	ordered: boolean | null | undefined,
	index: number,
): string {
	const indent = "  ".repeat(listDepth)
	const prefix = ordered ? `${index + 1}. ` : "• "
	const continuationIndent = `${indent}${" ".repeat(prefix.length)}`
	const renderedBlocks = item.children
		.map((child) => {
			if (isParagraphNode(child)) {
				return renderInlineNodes(child.children)
			}

			if (isListNode(child)) {
				return renderList(child, listDepth + 1)
			}

			return renderBlockNode(child, listDepth + 1)
		})
		.filter((block): block is string => block.trim().length > 0)

	if (renderedBlocks.length === 0) {
		return `${indent}${prefix}`.trimEnd()
	}

	const [firstBlock, ...restBlocks] = renderedBlocks
	const lines = [`${indent}${prefix}${firstBlock}`]
	for (const block of restBlocks) {
		const blockLines = block.split("\n")
		for (const line of blockLines) {
			lines.push(`${continuationIndent}${line}`)
		}
	}

	return lines.join("\n")
}

function tokenizeHtml(html: string): HtmlToken[] {
	const tokens: HtmlToken[] = []
	let cursor = 0

	while (cursor < html.length) {
		if (html[cursor] === "<") {
			const closingBracket = html.indexOf(">", cursor)
			if (closingBracket !== -1) {
				const rawTag = html.slice(cursor, closingBracket + 1)
				tokens.push(parseHtmlTagToken(rawTag))
				cursor = closingBracket + 1
				continue
			}
		}

		const nextTag = html.indexOf("<", cursor)
		const rawText = html.slice(cursor, nextTag === -1 ? html.length : nextTag)
		tokens.push(...tokenizeHtmlText(rawText))
		cursor = nextTag === -1 ? html.length : nextTag
	}

	return tokens
}

function parseHtmlTagToken(rawTag: string): HtmlToken {
	const closingMatch = rawTag.match(/^<\/([a-z0-9-]+)\s*>$/i)
	if (closingMatch) {
		const tagName = closingMatch[1]?.toLowerCase()
		if (tagName && TELEGRAM_HTML_ALLOWED_TAGS.has(tagName)) {
			return { kind: "tag", raw: rawTag, tagName, isClosing: true, isSelfClosing: false }
		}
		return { kind: "text", raw: escapeTelegramHtml(rawTag), visibleLength: rawTag.length }
	}

	const openingMatch = rawTag.match(/^<([a-z0-9-]+)(?:\s[^>]*)?>$/i)
	if (!openingMatch) {
		return { kind: "text", raw: escapeTelegramHtml(rawTag), visibleLength: rawTag.length }
	}

	const tagName = openingMatch[1]?.toLowerCase()
	const isSelfClosing = rawTag.endsWith("/>")
	if (!tagName || !TELEGRAM_HTML_ALLOWED_TAGS.has(tagName) || isSelfClosing) {
		return { kind: "text", raw: escapeTelegramHtml(rawTag), visibleLength: rawTag.length }
	}

	return { kind: "tag", raw: rawTag, tagName, isClosing: false, isSelfClosing: false }
}

function tokenizeHtmlText(text: string): HtmlToken[] {
	const tokens: HtmlToken[] = []
	const entityPattern = /&(?:[a-zA-Z]+|#\d+|#x[\dA-Fa-f]+);/g
	let cursor = 0

	for (const match of text.matchAll(entityPattern)) {
		const matchIndex = match.index ?? 0
		const rawEntity = match[0]
		if (matchIndex > cursor) {
			tokens.push(...tokenizePlainText(text.slice(cursor, matchIndex)))
		}
		tokens.push({ kind: "text", raw: rawEntity, visibleLength: 1 })
		cursor = matchIndex + rawEntity.length
	}

	if (cursor < text.length) {
		tokens.push(...tokenizePlainText(text.slice(cursor)))
	}

	return tokens
}

function tokenizePlainText(text: string): HtmlToken[] {
	return Array.from(text, (character) => ({
		kind: "text" as const,
		raw: character,
		visibleLength: 1,
	}))
}

function isSplitBreakpoint(token: HtmlToken): boolean {
	return token.kind === "text" && /^\s$/.test(token.raw)
}

function computeOpenTags(tokens: HtmlToken[]): OpenTag[] {
	const openTags: OpenTag[] = []

	for (const token of tokens) {
		if (token.kind !== "tag" || !token.tagName) continue
		if (token.isClosing) {
			let existingIndex = -1
			for (let index = openTags.length - 1; index >= 0; index -= 1) {
				if (openTags[index]?.name === token.tagName) {
					existingIndex = index
					break
				}
			}
			if (existingIndex !== -1) {
				openTags.splice(existingIndex, 1)
			}
			continue
		}

		if (!token.isSelfClosing) {
			openTags.push({ name: token.tagName, openTag: token.raw })
		}
	}

	return openTags
}

function recalculateChunkState(tokens: HtmlToken[]) {
	let visibleLength = 0
	let splitPosition: number | null = null

	for (const [index, token] of tokens.entries()) {
		if (token.kind === "text") {
			visibleLength += token.visibleLength
		}
		if (isSplitBreakpoint(token)) {
			splitPosition = index + 1
		}
	}

	return { visibleLength, splitPosition }
}

function closeOpenTags(openTags: OpenTag[]): string {
	return [...openTags]
		.reverse()
		.map((tag) => `</${tag.name}>`)
		.join("")
}

function reopenTags(openTags: OpenTag[]): HtmlToken[] {
	return openTags.map((tag) => ({ kind: "tag" as const, raw: tag.openTag, tagName: tag.name }))
}

export function splitTelegramHtmlMessage(html: string, maxVisibleLength = 4096): string[] {
	const tokens = tokenizeHtml(html)
	if (tokens.length === 0) return [html]

	const chunks: string[] = []
	let currentTokens: HtmlToken[] = []
	let currentVisibleLength = 0
	let splitPosition: number | null = null

	const flush = (position = currentTokens.length) => {
		const keptTokens = currentTokens.slice(0, position)
		const openTags = computeOpenTags(keptTokens)
		const chunk = `${keptTokens.map((token) => token.raw).join("")}${closeOpenTags(openTags)}`
		if (chunk.length > 0) {
			chunks.push(chunk)
		}

		currentTokens = [...reopenTags(openTags), ...currentTokens.slice(position)]
		const nextState = recalculateChunkState(currentTokens)
		currentVisibleLength = nextState.visibleLength
		splitPosition = nextState.splitPosition
	}

	for (const token of tokens) {
		const nextVisibleLength =
			currentVisibleLength + (token.kind === "text" ? token.visibleLength : 0)
		if (currentVisibleLength > 0 && nextVisibleLength > maxVisibleLength) {
			flush(splitPosition ?? currentTokens.length)
		}

		currentTokens.push(token)
		if (token.kind === "text") {
			currentVisibleLength += token.visibleLength
		}
		if (isSplitBreakpoint(token)) {
			splitPosition = currentTokens.length
		}
	}

	if (currentTokens.length > 0) {
		flush()
	}

	return chunks.length > 0 ? chunks : [html]
}

export { TELEGRAM_HTML_PARSE_MODE }
