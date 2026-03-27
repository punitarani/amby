import {
	type Blockquote,
	type Code,
	type Content,
	type Delete,
	type Emphasis,
	type InlineCode,
	type Link,
	type List,
	type ListItem,
	type MdastTable,
	type Paragraph,
	parseMarkdown,
	type Strong,
	type Text,
	tableToAscii,
} from "chat"

const TELEGRAM_MAX_TEXT_LENGTH = 4096

type HeadingNode = {
	type: "heading"
	depth: number
	children: Content[]
}

type HtmlNode = {
	type: "html"
	value: string
}

type ImageNode = {
	type: "image"
	alt?: string | null
	url: string
}

type RenderedBlock = {
	html: string
	plainText: string
}

export type TelegramRenderedChunk = RenderedBlock

export function renderTelegramMessageChunks(
	markdown: string,
	maxTextLength = TELEGRAM_MAX_TEXT_LENGTH,
): TelegramRenderedChunk[] {
	const ast = parseMarkdown(markdown)
	const blocks = ast.children
		.flatMap((node) => renderBlock(node))
		.filter((block) => block.plainText.trim().length > 0 || block.html.trim().length > 0)

	if (blocks.length === 0) {
		return markdown.trim() ? [{ html: escapeTelegramHtml(markdown), plainText: markdown }] : []
	}

	const chunks: TelegramRenderedChunk[] = []
	let current: RenderedBlock[] = []
	let currentLength = 0

	for (const block of blocks.flatMap((candidate) =>
		splitOversizedBlock(candidate, maxTextLength),
	)) {
		const separatorLength = current.length > 0 ? 2 : 0
		if (
			current.length > 0 &&
			currentLength + separatorLength + block.plainText.length > maxTextLength
		) {
			chunks.push(joinBlocks(current))
			current = [block]
			currentLength = block.plainText.length
			continue
		}

		current.push(block)
		currentLength += separatorLength + block.plainText.length
	}

	if (current.length > 0) {
		chunks.push(joinBlocks(current))
	}

	return chunks
}

function joinBlocks(blocks: RenderedBlock[]): TelegramRenderedChunk {
	return {
		html: blocks.map((block) => block.html).join("\n\n"),
		plainText: blocks.map((block) => block.plainText).join("\n\n"),
	}
}

function splitOversizedBlock(block: RenderedBlock, maxTextLength: number): RenderedBlock[] {
	if (block.plainText.length <= maxTextLength) {
		return [block]
	}

	// If a single rendered block exceeds Telegram's parsed-text limit, fall back
	// to plain-text chunks so delivery stays correct instead of splitting HTML tags.
	return splitPlainText(block.plainText, maxTextLength).map((segment) => ({
		html: escapeTelegramHtml(segment),
		plainText: segment,
	}))
}

function splitPlainText(text: string, maxLength: number): string[] {
	if (text.length <= maxLength) {
		return [text]
	}

	const chunks: string[] = []
	let remaining = text

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining)
			break
		}

		let splitIndex = remaining.lastIndexOf("\n", maxLength)
		if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
			splitIndex = remaining.lastIndexOf(" ", maxLength)
		}
		if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
			splitIndex = maxLength
		}

		chunks.push(remaining.slice(0, splitIndex))
		remaining = remaining.slice(splitIndex).trimStart()
	}

	return chunks
}

function renderBlock(node: Content): RenderedBlock[] {
	switch (node.type) {
		case "paragraph":
			return [renderParagraph(node)]
		case "heading":
			return [renderHeading(node as HeadingNode)]
		case "code":
			return [renderCode(node)]
		case "blockquote":
			return [renderBlockquote(node)]
		case "list":
			return [renderList(node)]
		case "table":
			return [renderTable(node as MdastTable)]
		default: {
			const plainText = extractPlainText(node)
			if (!plainText.trim()) return []
			return [{ html: escapeTelegramHtml(plainText), plainText }]
		}
	}
}

function renderParagraph(node: Paragraph): RenderedBlock {
	return renderInlineNodes(node.children as Content[])
}

function renderHeading(node: HeadingNode): RenderedBlock {
	const content = renderInlineNodes(node.children)
	return wrapTag("b", content)
}

function renderCode(node: Code): RenderedBlock {
	const value = node.value ?? ""
	if (node.lang?.trim()) {
		return {
			html: `<pre><code class="language-${escapeTelegramHtmlAttribute(node.lang)}">${escapeTelegramHtml(value)}</code></pre>`,
			plainText: value,
		}
	}

	return {
		html: `<pre>${escapeTelegramHtml(value)}</pre>`,
		plainText: value,
	}
}

function renderBlockquote(node: Blockquote): RenderedBlock {
	const innerBlocks = node.children.flatMap((child) => renderBlock(child as Content))
	const inner = joinBlocksWithSingleNewlines(innerBlocks)
	return {
		html: `<blockquote>${inner.html}</blockquote>`,
		plainText: inner.plainText,
	}
}

function renderTable(node: MdastTable): RenderedBlock {
	const ascii = tableToAscii(node)
	return {
		html: `<pre>${escapeTelegramHtml(ascii)}</pre>`,
		plainText: ascii,
	}
}

function renderList(node: List, depth = 0): RenderedBlock {
	const start = node.start ?? 1
	const lines = node.children.map((item, index) =>
		renderListItem(item, node.ordered ? `${start + index}. ` : "• ", depth),
	)

	return joinBlocksWithSingleNewlines(lines)
}

function renderListItem(item: ListItem, prefix: string, depth: number): RenderedBlock {
	const indent = "  ".repeat(depth)
	const continuationIndent = `${indent}  `
	const parts: RenderedBlock[] = []
	let isFirst = true

	for (const child of item.children) {
		if (child.type === "list") {
			parts.push(renderList(child as List, depth + 1))
			isFirst = false
			continue
		}

		const renderedBlocks = renderBlock(child as Content)
		for (const rendered of renderedBlocks) {
			const linePrefix = isFirst ? `${indent}${prefix}` : continuationIndent
			parts.push({
				html: `${linePrefix}${rendered.html}`,
				plainText: `${linePrefix}${rendered.plainText}`,
			})
			isFirst = false
		}
	}

	return joinBlocksWithSingleNewlines(parts)
}

function joinBlocksWithSingleNewlines(blocks: RenderedBlock[]): RenderedBlock {
	return {
		html: blocks.map((block) => block.html).join("\n"),
		plainText: blocks.map((block) => block.plainText).join("\n"),
	}
}

function renderInlineNodes(nodes: Content[]): RenderedBlock {
	const parts = nodes.map((node) => renderInlineNode(node))
	return {
		html: parts.map((part) => part.html).join(""),
		plainText: parts.map((part) => part.plainText).join(""),
	}
}

function renderInlineNode(node: Content): RenderedBlock {
	switch (node.type) {
		case "text":
			return renderText(node)
		case "strong":
			return wrapTag("b", renderInlineNodes(node.children as Content[]))
		case "emphasis":
			return wrapTag("i", renderInlineNodes(node.children as Content[]))
		case "delete":
			return wrapTag("s", renderInlineNodes(node.children as Content[]))
		case "inlineCode":
			return renderInlineCode(node)
		case "link":
			return renderLink(node)
		case "break":
			return { html: "\n", plainText: "\n" }
		case "image": {
			const alt = (node as ImageNode).alt?.trim() || (node as ImageNode).url
			return {
				html: escapeTelegramHtml(alt),
				plainText: alt,
			}
		}
		case "html":
			return renderText({ type: "text", value: (node as HtmlNode).value })
		default: {
			const plainText = extractPlainText(node)
			return {
				html: escapeTelegramHtml(plainText),
				plainText,
			}
		}
	}
}

function renderText(node: Text): RenderedBlock {
	return {
		html: escapeTelegramHtml(node.value),
		plainText: node.value,
	}
}

function renderInlineCode(node: InlineCode): RenderedBlock {
	return {
		html: `<code>${escapeTelegramHtml(node.value)}</code>`,
		plainText: node.value,
	}
}

function renderLink(node: Link): RenderedBlock {
	const content = renderInlineNodes(node.children as Content[])
	const plainText = content.plainText || node.url
	return {
		html: `<a href="${escapeTelegramHtmlAttribute(node.url)}">${content.html || escapeTelegramHtml(node.url)}</a>`,
		plainText,
	}
}

function wrapTag(tag: "b" | "i" | "s", content: RenderedBlock): RenderedBlock {
	return {
		html: `<${tag}>${content.html}</${tag}>`,
		plainText: content.plainText,
	}
}

function extractPlainText(
	node: Content | Delete | Emphasis | InlineCode | Link | Paragraph | Strong,
): string {
	switch (node.type) {
		case "text":
			return node.value
		case "inlineCode":
			return node.value
		case "code":
			return node.value ?? ""
		case "link":
			return node.children.map((child) => extractPlainText(child as Content)).join("") || node.url
		case "image":
			return (node as ImageNode).alt?.trim() || (node as ImageNode).url
		case "break":
			return "\n"
		default:
			return getChildNodes(node)
				.map((child) => extractPlainText(child))
				.join("")
	}
}

function getChildNodes(node: unknown): Content[] {
	if (
		typeof node === "object" &&
		node !== null &&
		"children" in node &&
		Array.isArray(node.children)
	) {
		return node.children as Content[]
	}
	return []
}

function escapeTelegramHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeTelegramHtmlAttribute(value: string): string {
	return escapeTelegramHtml(value).replaceAll('"', "&quot;")
}
