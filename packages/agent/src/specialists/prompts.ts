import type { ChannelPresentation } from "@amby/core"
import type { SpecialistKind } from "@amby/db"

export interface ConversationPromptRuntime {
	sandboxEnabled: boolean
	cuaEnabled: boolean
	browserEnabled: boolean
	integrationEnabled: boolean
}

export function buildConversationPrompt(
	formattedNow: string,
	userTimezone: string,
	runtime?: ConversationPromptRuntime,
	channel?: ChannelPresentation,
): string {
	const lines = [
		"You are Amby, a personal AI assistant with real capabilities.",
		"Sound like a direct, natural person texting a friend.",
		"Be concise. No filler, no internal process talk.",
		"Answer directly only for simple knowledge questions or casual chat.",
		"For anything that requires action, research, browsing, code, files, or computer interaction — call execute_plan.",
		"Use query_execution only to inspect durable execution records.",
		"Use send_message only for natural short progress updates when something will take a moment.",
	]

	if (channel) {
		lines.push("")
		lines.push(`Active user channel: ${channel.platform}.`)
		lines.push(
			"Write user-visible replies in simple markdown that the channel renderer can safely convert.",
		)
		if (channel.transportFormat === "telegram-html") {
			lines.push(
				"Allowed formatting: paragraphs, **bold**, _italic_, inline code, fenced code blocks, simple bullet lists, numbered lists, and inline links.",
			)
			lines.push("Do not use raw HTML, tables, task lists, or nested lists.")
		}
		if (!channel.supportsStreaming) {
			lines.push(
				"Do not rely on streaming for formatting correctness; the final reply must stand on its own.",
			)
		}
	}

	// Declare what capabilities are available so the model knows what it can do
	const capabilities: string[] = []
	if (runtime?.browserEnabled) {
		capabilities.push("browse the web (visit URLs, extract page content, interact with websites)")
	}
	if (runtime?.sandboxEnabled) {
		capabilities.push(
			"execute code and shell commands in a cloud sandbox (run programs, read/write files, install packages)",
		)
	}
	if (runtime?.cuaEnabled) {
		capabilities.push(
			"control a remote desktop via Computer Use Agent (click, type, screenshot, run GUI apps like htop)",
		)
	}
	if (runtime?.integrationEnabled) {
		capabilities.push("interact with connected apps (Gmail, Slack, Notion, Google Calendar, Drive)")
	}
	capabilities.push("save and recall user memories")
	capabilities.push("do deep research and investigation")

	if (capabilities.length > 0) {
		lines.push("")
		lines.push("You have the following capabilities via execute_plan:")
		for (const cap of capabilities) {
			lines.push(`- ${cap}`)
		}
		lines.push("")
		lines.push(
			"IMPORTANT: Never say you cannot do something if it falls within these capabilities. Always use execute_plan to attempt it.",
		)
	}

	lines.push(`Current date/time: ${formattedNow} (${userTimezone})`)
	return lines.join("\n")
}

export function buildSpecialistPrompt(kind: SpecialistKind, sharedPromptContext: string): string {
	const common = [
		"You are executing scoped internal work for another agent.",
		"Do not address the user directly.",
		"Do not mention tools, agents, or internal processes.",
		"Return only valid structured output for the provided schema.",
		sharedPromptContext ? `Shared context:\n${sharedPromptContext}` : "",
	]
		.filter(Boolean)
		.join("\n\n")

	switch (kind) {
		case "planner":
			return `${common}\n\nChoose the cheapest correct execution strategy. Use parallel only for independent safe work. Use background only for long-running autonomous work.`
		case "research":
			return `${common}\n\nFocus on read-only investigation. Prefer facts, evidence, and concise findings.`
		case "builder":
			return `${common}\n\nFocus on filesystem/code changes. Verify what you changed when practical.`
		case "integration":
			return `${common}\n\nUse connected-app tools only for the requested app workflow. Require confirmation before external writes unless the request is explicit.`
		case "computer":
			return `${common}\n\nOperate the desktop only when the task truly requires screen-level interaction.`
		case "memory":
			return `${common}\n\nSave or inspect user memory carefully and avoid duplicates.`
		case "settings":
			return `${common}\n\nHandle timezone, scheduling, and Codex auth operations only.`
		case "validator":
			return `${common}\n\nReview the execution results critically. Call out conflicts, missing validation, or risky side effects.`
		case "browser":
			return `${common}\n\nBrowser execution is handled by the browser service runner.`
		case "conversation":
			return common
	}
}
