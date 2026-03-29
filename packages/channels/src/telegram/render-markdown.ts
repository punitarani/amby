import { micromark } from "micromark"
import { gfm, gfmHtml } from "micromark-extension-gfm"

type HtmlNode = HtmlElementNode | HtmlTextNode

interface HtmlElementNode {
	kind: "element"
	tag: string
	attributes: Record<string, string | true>
	children: HtmlNode[]
}

interface HtmlTextNode {
	kind: "text"
	value: string
}

export interface TelegramRenderedChunk {
	text: string
	parseMode: "HTML"
}

const TELEGRAM_PARSE_MODE = "HTML" as const
const VOID_TAGS = new Set(["br", "hr", "img", "input"])

export function renderTelegramMarkdownToHtml(markdown: string): string {
	const source = markdown.trim()
	if (!source) return ""

	const html = micromark(source, {
		extensions: [gfm()],
		htmlExtensions: [gfmHtml()],
	})

	const blocks = renderBlockNodes(parseHtmlFragment(html))
	return blocks.join("\n\n").trim()
}

export function renderTelegramMarkdownChunks(
	markdown: string,
	maxLength = 4096,
): TelegramRenderedChunk[] {
	const rendered = renderTelegramMarkdownToHtml(markdown)
	if (!rendered) return []
	return splitTelegramHtml(rendered, maxLength).map((text) => ({
		text,
		parseMode: TELEGRAM_PARSE_MODE,
	}))
}

export function splitTelegramHtml(html: string, maxLength = 4096): string[] {
	if (html.length <= maxLength) return [html]

	const chunks: string[] = []
	const tokens = tokenizeRenderedHtml(html)
	const openTags: Array<{ tag: string; openTag: string }> = []
	let current = ""

	const closingTags = () =>
		[...openTags]
			.reverse()
			.map((tag) => `</${tag.tag}>`)
			.join("")
	const reopeningTags = () => openTags.map((tag) => tag.openTag).join("")

	const pushChunk = () => {
		if (!hasRenderableContent(current)) return
		const completed = `${current}${closingTags()}`
		chunks.push(completed)
		current = reopeningTags()
	}

	for (const token of tokens) {
		if (token.kind === "text") {
			let remaining = token.value
			while (remaining.length > 0) {
				const available = maxLength - current.length - closingTags().length
				if (available <= 0) {
					pushChunk()
					continue
				}
				if (remaining.length <= available) {
					current += remaining
					break
				}

				const splitIndex = findTextSplitIndex(remaining, available)
				current += remaining.slice(0, splitIndex)
				pushChunk()
				remaining = remaining.slice(splitIndex)
			}
			continue
		}

		const nextLength = current.length + token.raw.length + closingTags().length
		if (nextLength > maxLength && hasRenderableContent(current)) {
			pushChunk()
		}

		current += token.raw

		if (token.kind === "open") {
			openTags.push({ tag: token.tag, openTag: token.raw })
		} else if (token.kind === "close") {
			const matchIndex = findLastTagIndex(openTags, token.tag)
			if (matchIndex >= 0) {
				openTags.splice(matchIndex, 1)
			}
		}
	}

	if (hasRenderableContent(current)) {
		chunks.push(`${current}${closingTags()}`)
	}

	return chunks
}

function hasRenderableContent(value: string): boolean {
	return value.replace(/<[^>]+>/g, "").trim().length > 0
}

function findTextSplitIndex(value: string, maxLength: number): number {
	const preferred = findPreferredSplit(value, maxLength)
	return avoidEntityBoundary(value, preferred)
}

function findPreferredSplit(value: string, maxLength: number): number {
	if (value.length <= maxLength) return value.length

	const hardLimit = Math.max(1, maxLength)
	const newlineIndex = value.lastIndexOf("\n", hardLimit)
	if (newlineIndex >= Math.floor(hardLimit * 0.5)) {
		return newlineIndex + 1
	}

	const spaceIndex = value.lastIndexOf(" ", hardLimit)
	if (spaceIndex >= Math.floor(hardLimit * 0.5)) {
		return spaceIndex + 1
	}

	return hardLimit
}

function avoidEntityBoundary(value: string, splitIndex: number): number {
	const clamped = Math.max(1, Math.min(splitIndex, value.length))
	const ampIndex = value.lastIndexOf("&", clamped)
	const semiIndex = value.lastIndexOf(";", clamped)
	if (ampIndex > semiIndex) {
		const closingSemi = value.indexOf(";", ampIndex)
		if (closingSemi >= clamped) {
			return ampIndex > 0 ? ampIndex : Math.min(closingSemi + 1, value.length)
		}
	}
	return clamped
}

function tokenizeRenderedHtml(
	html: string,
): Array<
	{ kind: "text"; value: string } | { kind: "open" | "close" | "self"; tag: string; raw: string }
> {
	const tokens: Array<
		{ kind: "text"; value: string } | { kind: "open" | "close" | "self"; tag: string; raw: string }
	> = []
	const pattern = /(<[^>]+>|[^<]+)/g
	for (const match of html.matchAll(pattern)) {
		const token = match[0]
		if (!token) continue
		if (!token.startsWith("<")) {
			tokens.push({ kind: "text", value: token })
			continue
		}

		const tagMatch = /^<\s*(\/)?\s*([a-zA-Z0-9-]+)([^>]*)>$/.exec(token)
		if (!tagMatch) continue
		const isClosing = Boolean(tagMatch[1])
		const tag = tagMatch[2]?.toLowerCase()
		if (!tag) continue
		const selfClosing = !isClosing && (token.endsWith("/>") || VOID_TAGS.has(tag))
		tokens.push({
			kind: isClosing ? "close" : selfClosing ? "self" : "open",
			tag,
			raw: token,
		})
	}
	return tokens
}

function parseHtmlFragment(html: string): HtmlNode[] {
	const root: HtmlElementNode = {
		kind: "element",
		tag: "root",
		attributes: {},
		children: [],
	}

	const stack: HtmlElementNode[] = [root]
	const pattern = /(<[^>]+>|[^<]+)/g

	for (const match of html.matchAll(pattern)) {
		const token = match[0]
		if (!token) continue

		const parent = stack.at(-1)
		if (!parent) continue

		if (!token.startsWith("<")) {
			parent.children.push({ kind: "text", value: token })
			continue
		}

		const tagMatch = /^<\s*(\/)?\s*([a-zA-Z0-9-]+)([^>]*)>$/.exec(token)
		if (!tagMatch) continue

		const isClosing = Boolean(tagMatch[1])
		const tag = tagMatch[2]?.toLowerCase()
		const rawAttrs = tagMatch[3] ?? ""
		if (!tag) continue

		if (isClosing) {
			const matchIndex = findLastTagIndex(stack, tag)
			if (matchIndex >= 0) {
				stack.splice(matchIndex)
			}
			continue
		}

		const node: HtmlElementNode = {
			kind: "element",
			tag,
			attributes: parseTagAttributes(rawAttrs),
			children: [],
		}
		parent.children.push(node)
		if (!(token.endsWith("/>") || VOID_TAGS.has(tag))) {
			stack.push(node)
		}
	}

	return root.children
}

function parseTagAttributes(source: string): Record<string, string | true> {
	const attrs: Record<string, string | true> = {}
	const pattern = /([^\s=/>]+)(?:="([^"]*)"|'([^']*)'|=([^\s>]+))?/g
	for (const match of source.matchAll(pattern)) {
		const name = match[1]?.toLowerCase()
		if (!name) continue
		const value = match[2] ?? match[3] ?? match[4]
		attrs[name] = value === undefined ? true : value
	}
	return attrs
}

function renderBlockNodes(nodes: HtmlNode[]): string[] {
	const blocks: string[] = []

	for (const node of nodes) {
		if (node.kind === "text") {
			const value = normalizeInlineText(node.value).trim()
			if (value) blocks.push(value)
			continue
		}

		switch (node.tag) {
			case "p": {
				const paragraph = renderInlineNodes(node.children).trim()
				if (paragraph) blocks.push(paragraph)
				break
			}
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6": {
				const heading = renderInlineNodes(node.children).trim()
				if (heading) blocks.push(`<b>${heading}</b>`)
				break
			}
			case "ul":
			case "ol": {
				const list = renderList(node, 0)
				if (list) blocks.push(list)
				break
			}
			case "blockquote": {
				const quote = renderBlockquote(node)
				if (quote) blocks.push(quote)
				break
			}
			case "pre": {
				const pre = renderPreformatted(node)
				if (pre) blocks.push(pre)
				break
			}
			case "table": {
				const table = renderTable(node)
				if (table) blocks.push(table)
				break
			}
			case "hr":
				blocks.push("----------")
				break
			default: {
				const nestedBlocks = renderBlockNodes(node.children)
				if (nestedBlocks.length > 0) {
					blocks.push(...nestedBlocks)
					break
				}

				const inline = renderInlineNodes([node]).trim()
				if (inline) blocks.push(inline)
				break
			}
		}
	}

	return blocks
}

function renderInlineNodes(nodes: HtmlNode[]): string {
	return nodes.map(renderInlineNode).join("")
}

function renderInlineNode(node: HtmlNode): string {
	if (node.kind === "text") {
		return normalizeInlineText(node.value)
	}

	switch (node.tag) {
		case "strong":
		case "b": {
			const content = renderInlineNodes(node.children)
			return content ? `<b>${content}</b>` : ""
		}
		case "em":
		case "i": {
			const content = renderInlineNodes(node.children)
			return content ? `<i>${content}</i>` : ""
		}
		case "del":
		case "s":
		case "strike": {
			const content = renderInlineNodes(node.children)
			return content ? `<s>${content}</s>` : ""
		}
		case "code": {
			const content = extractEscapedText(node).trim()
			return content ? `<code>${content}</code>` : ""
		}
		case "a": {
			const href = typeof node.attributes.href === "string" ? node.attributes.href : ""
			const label = renderInlineNodes(node.children).trim() || escapeTelegramHtmlText(href)
			return href ? `<a href="${escapeTelegramHtmlAttribute(href)}">${label}</a>` : label
		}
		case "br":
			return "\n"
		case "img": {
			const src = typeof node.attributes.src === "string" ? node.attributes.src : ""
			const alt =
				typeof node.attributes.alt === "string"
					? escapeTelegramHtmlText(node.attributes.alt)
					: "image"
			return src ? `<a href="${escapeTelegramHtmlAttribute(src)}">${alt}</a>` : alt
		}
		case "input":
			return node.attributes.checked === true || node.attributes.checked === "" ? "[x] " : "[ ] "
		default:
			return renderInlineNodes(node.children)
	}
}

function renderList(node: HtmlElementNode, level: number): string {
	const ordered = node.tag === "ol"
	const start =
		typeof node.attributes.start === "string" ? Number.parseInt(node.attributes.start, 10) || 1 : 1

	const items = node.children.filter(
		(child): child is HtmlElementNode => child.kind === "element" && child.tag === "li",
	)

	return items
		.map((item, index) => renderListItem(item, level, ordered, start + index))
		.filter(Boolean)
		.join("\n")
}

function renderListItem(
	node: HtmlElementNode,
	level: number,
	ordered: boolean,
	number: number,
): string {
	const marker = `${"  ".repeat(level)}${ordered ? `${number}. ` : "- "}`
	const continuation = " ".repeat(marker.length)
	const bodyLines: string[] = []
	const nestedBlocks: string[] = []
	const inlineParts: string[] = []

	const flushInlineParts = () => {
		const rendered = inlineParts.join("").trim()
		inlineParts.length = 0
		if (!rendered) return
		bodyLines.push(...rendered.split("\n"))
	}

	for (const child of node.children) {
		if (child.kind === "element" && (child.tag === "ul" || child.tag === "ol")) {
			flushInlineParts()
			const nested = renderList(child, level + 1)
			if (nested) nestedBlocks.push(nested)
			continue
		}

		if (
			child.kind === "element" &&
			(child.tag === "blockquote" || child.tag === "pre" || child.tag === "table")
		) {
			flushInlineParts()
			const rendered = renderListItemChild(child)
			if (!rendered) continue
			bodyLines.push(...rendered.split("\n"))
			continue
		}

		const rendered = renderListItemChild(child)
		if (!rendered) continue
		inlineParts.push(rendered)
	}
	flushInlineParts()

	const lines: string[] = []
	if (bodyLines.length > 0) {
		lines.push(`${marker}${bodyLines[0]}`)
		for (const line of bodyLines.slice(1)) {
			lines.push(`${continuation}${line}`)
		}
	} else {
		lines.push(marker.trimEnd())
	}

	for (const nested of nestedBlocks) {
		lines.push(nested)
	}

	return lines.join("\n")
}

function renderListItemChild(node: HtmlNode): string {
	if (node.kind === "text") {
		return normalizeInlineText(node.value)
	}

	switch (node.tag) {
		case "p":
			return renderInlineNodes(node.children).trim()
		case "blockquote":
			return renderBlockquote(node)
		case "pre":
			return renderPreformatted(node)
		case "table":
			return renderTable(node)
		case "h1":
		case "h2":
		case "h3":
		case "h4":
		case "h5":
		case "h6": {
			const heading = renderInlineNodes(node.children).trim()
			return heading ? `<b>${heading}</b>` : ""
		}
		default:
			return renderInlineNodes([node]).trim()
	}
}

function renderBlockquote(node: HtmlElementNode): string {
	const content = renderBlockNodes(node.children)
		.join("\n")
		.replace(/<\/?blockquote(?: expandable)?>/g, "")
		.trim()

	if (!content) return ""

	const expandable = Object.hasOwn(node.attributes, "expandable")
	return `<blockquote${expandable ? " expandable" : ""}>${content}</blockquote>`
}

function renderPreformatted(node: HtmlElementNode): string {
	const codeChild = node.children.find(
		(child): child is HtmlElementNode => child.kind === "element" && child.tag === "code",
	)
	if (codeChild) {
		const languageClass =
			typeof codeChild.attributes.class === "string" ? codeChild.attributes.class : undefined
		const language = languageClass?.startsWith("language-") === true ? languageClass : undefined
		const code = extractEscapedText(codeChild)
		if (!code) return ""
		return language
			? `<pre><code class="${escapeTelegramHtmlAttribute(language)}">${code}</code></pre>`
			: `<pre><code>${code}</code></pre>`
	}

	const content = extractEscapedText(node)
	return content ? `<pre>${content}</pre>` : ""
}

function renderTable(node: HtmlElementNode): string {
	const rows = collectTableRows(node)
	if (rows.length === 0) return ""
	const headerRow = rows[0]
	if (!headerRow) return ""

	const widths = headerRow.map((_, index) =>
		Math.max(...rows.map((row) => row[index]?.length ?? 0)),
	)

	const formatRow = (row: string[]) =>
		row
			.map((cell, index) => escapeTelegramHtmlText(cell).padEnd(widths[index] ?? cell.length, " "))
			.join(" | ")
			.trimEnd()

	const separator = widths.map((width) => "-".repeat(width)).join("-|-")
	const [, ...body] = rows
	const lines = [formatRow(headerRow), separator, ...body.map(formatRow)].filter(Boolean)
	return lines.length > 0 ? `<pre>${lines.join("\n")}</pre>` : ""
}

function collectTableRows(node: HtmlElementNode): string[][] {
	const rows: string[][] = []

	const visit = (current: HtmlElementNode) => {
		if (current.tag === "tr") {
			const cells = current.children
				.filter(
					(child): child is HtmlElementNode =>
						child.kind === "element" && (child.tag === "th" || child.tag === "td"),
				)
				.map((cell) => collapseWhitespace(extractPlainText(cell)))
			if (cells.some((cell) => cell.length > 0)) {
				rows.push(cells)
			}
			return
		}

		for (const child of current.children) {
			if (child.kind === "element") {
				visit(child)
			}
		}
	}

	visit(node)
	return rows
}

function extractEscapedText(node: HtmlNode): string {
	if (node.kind === "text") return node.value
	if (node.tag === "br") return "\n"
	if (node.tag === "input") {
		return node.attributes.checked === true || node.attributes.checked === "" ? "[x] " : "[ ] "
	}
	return node.children.map(extractEscapedText).join("")
}

function extractPlainText(node: HtmlNode): string {
	return decodeHtmlEntities(extractEscapedText(node))
}

function normalizeInlineText(value: string): string {
	return value.replace(/\r/g, "").replace(/\n/g, " ")
}

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim()
}

function escapeTelegramHtmlText(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeTelegramHtmlAttribute(value: string): string {
	return escapeTelegramHtmlText(decodeHtmlEntities(value)).replaceAll('"', "&quot;")
}

function decodeHtmlEntities(value: string): string {
	return value.replace(
		/&(?:lt|gt|amp|quot);|&#(\d+);|&#x([0-9a-fA-F]+);/g,
		(match, decimal, hex) => {
			if (match === "&lt;") return "<"
			if (match === "&gt;") return ">"
			if (match === "&amp;") return "&"
			if (match === "&quot;") return '"'
			if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10))
			if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
			return match
		},
	)
}

function findLastTagIndex<T extends { tag: string }>(items: T[], tag: string): number {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		if (items[index]?.tag === tag) return index
	}
	return -1
}
