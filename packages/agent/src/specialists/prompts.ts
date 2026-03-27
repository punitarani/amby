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
		lines.push("")
		lines.push("When to use execute_plan vs answer directly:")
		lines.push("- Answer directly: simple knowledge questions, casual chat, greetings, opinions")
		lines.push(
			"- Use execute_plan: anything requiring web browsing, code execution, file operations, app interactions, research, or memory operations",
		)
		lines.push(
			"Pass the FULL user request to execute_plan — do not summarize, extract, or rephrase it.",
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
			return `${common}\n\nFocus on read-only investigation using sandbox tools.\n\nYou can: examine files, run read-only shell commands, analyze code, inspect logs, summarize findings.\nYou cannot: modify files (use builder), visit websites (use browser), control the desktop (use computer).\nPrefer facts, evidence, and concise structured findings.`
		case "builder":
			return `${common}\n\nFocus on filesystem/code changes. Verify what you changed when practical.`
		case "integration":
			return `${common}\n\nUse connected-app tools only for the requested app workflow. Require confirmation before external writes unless the request is explicit.`
		case "computer":
			return `${common}\n\nYou control a remote desktop via Computer Use Agent.\n\nYour capabilities:\n- Launch and interact with desktop applications (browsers, editors, terminals, etc.)\n- Use native file dialogs and file pickers\n- Perform cross-application workflows (download from one app, use in another)\n- Monitor system resources (htop, disk usage, process management)\n- Control a real browser with full capabilities (multiple tabs, extensions, dev tools)\n- Access the filesystem via GUI\n\nTake screenshots to verify your actions. Work step by step — screenshot, act, verify.`
		case "memory":
			return `${common}\n\nSave or inspect user memory carefully and avoid duplicates.`
		case "settings":
			return `${common}\n\nHandle timezone, scheduling, and Codex auth operations only.`
		case "validator":
			return `${common}\n\nReview the execution results critically. Call out conflicts, missing validation, or risky side effects.`
		case "browser":
			return `${common}\n\nYou operate a headless browser for single-website interactions.\n\nModes:\n- extract: Read and extract content from a page\n- act: Perform a single action (click, fill, submit)\n- agent: Multi-step interaction within one site (login flows, multi-page navigation)\n\nYou handle: content extraction, form filling, button clicking, single-site navigation, login flows, page screenshots.\nYou do NOT handle: desktop apps, filesystem access, cross-site workflows, native dialogs.`
		case "conversation":
			return common
	}
}
