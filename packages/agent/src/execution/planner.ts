import { sanitizeBrowserStartUrl } from "@amby/browser"
import type { SpecialistKind } from "@amby/db"
import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type { AgentRunConfig } from "../types/agent"
import type { BrowserTaskInput } from "../types/browser"
import type { ExecutionPlan, ExecutionTaskInput, PlannedTask } from "../types/execution"
import type { SettingsTaskInput } from "../types/settings"
import { getSpecialistDefinition } from "./registry"

// ---------------------------------------------------------------------------
// Preprocessing (not routing — extracts structured context for the router)
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g
/** Matches bare domain names like "nytimes.com", "docs.google.com" */
const BARE_DOMAIN_RE =
	/\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|dev|co|ai|app|xyz|me|info|edu|gov)\b/i

export function extractUrls(text: string): string[] {
	const fullUrls = [...text.matchAll(URL_RE)]
		.map((match) => sanitizeBrowserStartUrl(match[0]))
		.filter((url): url is string => Boolean(url))

	const bareDomains = [...text.matchAll(new RegExp(BARE_DOMAIN_RE, "gi"))]
		.map((match) => {
			const domain = match[0]
			if (fullUrls.some((url) => url.includes(domain))) return null
			return sanitizeBrowserStartUrl(`https://${domain}`)
		})
		.filter((url): url is string => Boolean(url))

	return [...new Set([...fullUrls, ...bareDomains])]
}

export function extractPathHints(text: string): string[] {
	const matches = text.match(/\/[A-Za-z0-9._~/-]+/g) ?? []
	return [...new Set(matches)]
}

// ---------------------------------------------------------------------------
// Task creation helpers
// ---------------------------------------------------------------------------

function createSpecialistTask(
	agent: SpecialistKind,
	input: ExecutionTaskInput,
	options?: {
		dependencies?: string[]
		resourceLocks?: string[]
		mutates?: boolean
		writesExternal?: boolean
		requiresConfirmation?: boolean
		requiresValidation?: boolean
	},
): PlannedTask {
	const definition = getSpecialistDefinition(agent)
	return {
		parentTaskId: undefined,
		spawnedBySpecialist: undefined,
		specialist: agent,
		runnerKind: definition.runnerKind,
		mode: definition.runnerKind === "background_handoff" ? "background" : "sequential",
		input,
		dependencies: options?.dependencies ?? [],
		inputBindings: {},
		resourceLocks: options?.resourceLocks ?? [],
		mutates: options?.mutates ?? false,
		writesExternal: options?.writesExternal ?? false,
		requiresConfirmation: options?.requiresConfirmation ?? false,
		requiresValidation: options?.requiresValidation ?? false,
	}
}

function createBrowserTask(params: {
	instruction: string
	startUrl?: string
	outputMode?: BrowserTaskInput["mode"]
	sideEffectLevel?: BrowserTaskInput["sideEffectLevel"]
	expectedOutcome?: string
}): PlannedTask {
	return createSpecialistTask(
		"browser",
		{
			kind: "browser",
			task: {
				mode: params.outputMode ?? "agent",
				instruction: params.instruction,
				startUrl: params.startUrl,
				expectedOutcome: params.expectedOutcome,
				sideEffectLevel: params.sideEffectLevel ?? "read",
			},
		},
		{
			mutates: params.sideEffectLevel !== "read",
			writesExternal: params.sideEffectLevel === "hard-write",
			requiresConfirmation: params.sideEffectLevel === "hard-write",
		},
	)
}

function createBackgroundTask(prompt: string, needsBrowser: boolean): PlannedTask {
	return {
		...createSpecialistTask(
			"builder",
			{
				kind: "background",
				prompt,
				needsBrowser,
				instructions: "Work autonomously to completion and write final results into artifacts.",
			},
			{
				resourceLocks: ["sandbox-workdir:/"],
				mutates: true,
			},
		),
		runnerKind: "background_handoff",
		mode: "background",
	}
}

// ---------------------------------------------------------------------------
// Router output schema (simplified — code materializes into full ExecutionPlan)
// ---------------------------------------------------------------------------

const routerTaskSchema = z.object({
	specialist: z.enum([
		"browser",
		"computer",
		"research",
		"builder",
		"integration",
		"memory",
		"settings",
	]),
	goal: z.string().describe("Clear, specific description of what this task should accomplish"),
	dependencies: z
		.array(z.string())
		.default([])
		.describe("References like 'task-0' for sequential dependencies"),

	// Browser-specific (when specialist=browser)
	startUrl: z
		.string()
		.optional()
		.describe("URL to open — set when request mentions a specific URL"),
	browserMode: z
		.enum(["extract", "act", "agent"])
		.optional()
		.describe("extract=read content, act=single action, agent=multi-step same-site interaction"),
	sideEffectLevel: z
		.enum(["read", "soft-write", "hard-write"])
		.optional()
		.describe("Browser: read=view only, soft-write=form/login, hard-write=purchase/delete/send"),

	// Settings-specific (when specialist=settings)
	settingsKind: z.enum(["timezone", "schedule", "codex_auth"]).optional(),
	timezone: z.string().optional().describe("IANA timezone string like America/New_York"),

	// General write flag
	writesExternally: z
		.boolean()
		.optional()
		.describe(
			"True when the task sends messages, emails, makes purchases, or modifies external systems",
		),
})

export type RouterTask = z.infer<typeof routerTaskSchema>

export const routerOutputSchema = z.object({
	strategy: z.enum(["direct", "sequential", "parallel", "background"]),
	rationale: z.string().describe("One sentence explaining the routing decision"),
	tasks: z.array(routerTaskSchema).describe("Empty array for strategy=direct"),
	needsValidation: z.boolean().describe("True when tasks mutate filesystem or write externally"),
})

export type RouterOutput = z.infer<typeof routerOutputSchema>

// ---------------------------------------------------------------------------
// Router prompt
// ---------------------------------------------------------------------------

const ROUTER_SYSTEM_PROMPT = `You are a routing agent. Given a user request, decide which specialist(s) should handle it and how to configure them.

## Available Specialists

### browser
Headless browser (Stagehand) for SINGLE-WEBSITE interactions.
- **extract**: Read and extract content from a web page
- **act**: Perform a single action (click button, fill field, submit form)
- **agent**: Multi-step interaction within ONE site (login flow, navigate pages on same domain, fill multi-step forms)

USE WHEN:
- Visiting a URL to read/extract content
- Filling forms, clicking buttons, submitting on a webpage
- Logging into a website
- Single-site navigation and interaction
- Taking a screenshot of a webpage
- Scraping or crawling a single site

DO NOT USE WHEN:
- Task needs multiple separate websites in sequence (use computer)
- Task needs desktop apps, filesystem, or native dialogs (use computer)
- Task needs to download a file and use it in another app (use computer)

Configuration:
- startUrl: Set when a specific URL is in the request
- browserMode: "extract" for reading, "act" for one action, "agent" for multi-step
- sideEffectLevel: "read" for viewing, "soft-write" for form/login, "hard-write" for purchase/delete/send

### computer
Computer Use Agent — full remote desktop with GUI, apps, filesystem.
- Controls mouse, keyboard, can see the screen via screenshots
- Can launch and use any desktop application
- Can use a real browser (Chrome/Firefox) with full capabilities
- Has filesystem access

USE WHEN:
- Task requires launching or using desktop applications (VS Code, Terminal, Preview, etc.)
- Task requires native file dialogs or file pickers
- Task involves cross-application workflows (download from one app/site, use in another)
- Task requires desktop-level browser control (multiple tabs across different sites, browser extensions, dev tools)
- System monitoring (htop, Activity Monitor, disk usage, process management)
- Task mentions "desktop", "computer", "terminal", or specific app names
- Task requires interacting with OS-level features (notifications, system tray, settings)

DO NOT USE WHEN:
- Task is confined to a single website (use browser — faster and cheaper)
- Task only needs to read or interact with one web page
- Task is a simple form fill or content extraction from a URL

### research
Read-only investigation using sandbox tools (shell commands, file reading, code analysis).

USE WHEN:
- Analyzing code, files, or logs
- Running read-only shell commands (ls, cat, grep, find, curl GET, etc.)
- Investigating system state without changing it
- Summarizing or comparing information from files

DO NOT USE WHEN:
- Task requires visiting a website (use browser)
- Task requires writing/editing files (use builder)

### builder
Code and filesystem changes in a cloud sandbox.

USE WHEN:
- Writing, editing, or creating files
- Implementing features or fixing bugs in code
- Running build/test/install commands
- Any task that modifies the filesystem

Pair with research (as a dependency) when investigation is needed first.

### integration
Connected app operations via API.
Supported apps: Gmail, Slack, Notion, Google Calendar, Google Drive.

USE WHEN:
- Sending/reading emails (Gmail)
- Sending/reading Slack messages
- Creating/editing Notion pages
- Managing Google Calendar events
- Uploading/downloading Google Drive files

### memory
Save or recall user memories.

USE WHEN:
- User explicitly asks to remember, save, or store something
- User asks to recall or look up something previously saved

### settings
Timezone, scheduling, and authentication operations.

USE WHEN:
- Setting timezone (provide settingsKind="timezone" and the IANA timezone string)
- Creating reminders or scheduled tasks (provide settingsKind="schedule")
- Managing Codex authentication (provide settingsKind="codex_auth")

## Decision Rules

1. **Browser vs Computer**: If the task is confined to ONE website, use browser. If it needs the desktop, multiple apps, multiple separate sites, or filesystem, use computer.
2. **Research vs Browser**: If the user asks about web content (URL given), use browser. If they ask about local files, code, or commands, use research.
3. **Research before Builder**: If implementation needs investigation first, create research task as task-0, then builder task with dependencies=["task-0"].
4. **Parallel**: Use ONLY for independent, read-only tasks (e.g., extracting content from multiple URLs simultaneously).
5. **Background**: Use ONLY when the user explicitly asks for background, autonomous, or long-running work.
6. **Direct**: Return empty tasks array when the request is simple knowledge, casual chat, or doesn't need any specialist.
7. **Validation**: Set needsValidation=true when tasks write to filesystem, send external messages, or make purchases.
8. **External writes**: Set writesExternally=true when a task sends emails, posts messages, makes purchases, or modifies systems outside the sandbox.

## Examples

"Summarize the homepage of nytimes.com"
→ browser, extract, startUrl=https://nytimes.com, sideEffectLevel=read

"Take a screenshot of example.com"
→ browser, extract, startUrl=https://example.com, sideEffectLevel=read

"Fill in the contact form at https://example.com/contact with my name and email"
→ browser, agent, startUrl=https://example.com/contact, sideEffectLevel=soft-write

"Log into my account at https://app.example.com"
→ browser, agent, startUrl=https://app.example.com, sideEffectLevel=soft-write

"Compare https://siteA.com and https://siteB.com"
→ parallel, two browser extract tasks

"Open Chrome and navigate to example.com"
→ computer (launching a desktop app)

"Download the PDF from example.com and open it in Preview"
→ computer (cross-app: browser download + desktop app)

"Check htop for CPU usage"
→ computer (system monitoring tool)

"Open Terminal and run a command"
→ computer (desktop app)

"Download report from site A, then upload it to site B"
→ computer (cross-site file transfer), writesExternally=true

"Use the file picker to select a photo"
→ computer (native dialog)

"What does the auth middleware do?"
→ research

"Run ls -la in the project directory"
→ research (read-only command)

"Implement a login form component"
→ builder, needsValidation=true

"Research the codebase then fix the bug"
→ sequential: research (task-0) → builder (depends on task-0), needsValidation=true

"Check my Gmail for new messages"
→ integration

"Send an email to john@example.com"
→ integration, writesExternally=true, needsValidation=true

"Remember that my favorite color is blue"
→ memory

"Set my timezone to America/New_York"
→ settings, settingsKind=timezone, timezone=America/New_York

"Remind me to check the report every Monday"
→ settings, settingsKind=schedule

"Hello, how are you?"
→ direct (no tasks)`

export function buildRouterPrompt(params: {
	request: string
	urls: string[]
	pathHints: string[]
	runtime: AgentRunConfig["runtime"]
}): string {
	const capabilities: string[] = []
	capabilities.push(
		params.runtime.browserEnabled
			? "- Browser: enabled"
			: "- Browser: disabled — do not route to browser",
	)
	capabilities.push(
		params.runtime.cuaEnabled
			? "- Computer Use Agent: enabled"
			: "- Computer Use Agent: disabled — do not route to computer",
	)
	capabilities.push(
		params.runtime.sandboxEnabled
			? "- Cloud Sandbox (research/builder): enabled"
			: "- Cloud Sandbox: disabled — do not route to research or builder",
	)
	capabilities.push(
		params.runtime.integrationEnabled
			? "- Integrations (Gmail, Slack, etc.): enabled"
			: "- Integrations: disabled — do not route to integration",
	)

	const contextParts: string[] = []
	contextParts.push(
		`Available capabilities:\n${capabilities.join("\n")}\nOnly route to enabled capabilities. If the required capability is disabled, return strategy "direct" with empty tasks.`,
	)
	if (params.urls.length > 0) {
		contextParts.push(`URLs detected in request: ${params.urls.join(", ")}`)
	}
	if (params.pathHints.length > 0) {
		contextParts.push(`File paths detected in request: ${params.pathHints.join(", ")}`)
	}

	return `${ROUTER_SYSTEM_PROMPT}

## Context

${contextParts.join("\n\n")}

## Request

${params.request}`
}

// ---------------------------------------------------------------------------
// Materialization — converts simplified router output to full ExecutionPlan
// ---------------------------------------------------------------------------

function materializeSettingsInput(task: RouterTask): ExecutionTaskInput {
	switch (task.settingsKind) {
		case "timezone":
			return {
				kind: "settings" as const,
				task: {
					kind: "timezone" as const,
					timezone: task.timezone ?? task.goal,
				} satisfies SettingsTaskInput,
			}
		case "schedule":
			return {
				kind: "settings" as const,
				task: {
					kind: "schedule" as const,
					description: task.goal,
					schedule: { request: task.goal },
				} satisfies SettingsTaskInput,
			}
		case "codex_auth":
			return {
				kind: "settings" as const,
				task: {
					kind: "codex_auth" as const,
					action: "status" as const,
				} satisfies SettingsTaskInput,
			}
		default:
			return {
				kind: "specialist" as const,
				goal: task.goal,
				payload: { request: task.goal },
			}
	}
}

function materializeTask(task: RouterTask, pathHints: string[]): PlannedTask {
	switch (task.specialist) {
		case "browser":
			return {
				...createBrowserTask({
					instruction: task.goal,
					startUrl: task.startUrl,
					outputMode: task.browserMode ?? "agent",
					sideEffectLevel: task.sideEffectLevel ?? "read",
				}),
				dependencies: task.dependencies,
			}

		case "computer":
			return createSpecialistTask(
				"computer",
				{
					kind: "specialist",
					goal: task.goal,
					payload: { request: task.goal },
				},
				{
					dependencies: task.dependencies,
					resourceLocks: ["computer-desktop"],
					mutates: true,
					writesExternal: task.writesExternally ?? false,
					requiresConfirmation: task.writesExternally ?? false,
				},
			)

		case "research":
			return createSpecialistTask(
				"research",
				{
					kind: "specialist",
					goal: task.goal,
					payload: { request: task.goal },
				},
				{ dependencies: task.dependencies },
			)

		case "builder":
			return createSpecialistTask(
				"builder",
				{
					kind: "specialist",
					goal: task.goal,
					payload: { request: task.goal, pathHints },
				},
				{
					dependencies: task.dependencies,
					resourceLocks:
						pathHints.length > 0
							? pathHints.map((path) => `fs-write:${path}`)
							: ["sandbox-workdir:/"],
					mutates: true,
					requiresValidation: true,
				},
			)

		case "integration":
			return createSpecialistTask(
				"integration",
				{
					kind: "specialist",
					goal: task.goal,
					payload: { request: task.goal },
				},
				{
					dependencies: task.dependencies,
					resourceLocks: ["integration-write:external"],
					mutates: task.writesExternally ?? false,
					writesExternal: task.writesExternally ?? false,
					requiresConfirmation: task.writesExternally ?? false,
					requiresValidation: task.writesExternally ?? false,
				},
			)

		case "memory":
			return createSpecialistTask(
				"memory",
				{
					kind: "specialist",
					goal: task.goal,
					payload: { request: task.goal },
				},
				{
					dependencies: task.dependencies,
					resourceLocks: ["memory-write"],
					mutates: true,
				},
			)

		case "settings":
			return createSpecialistTask("settings", materializeSettingsInput(task), {
				dependencies: task.dependencies,
				mutates: true,
			})
	}
}

export function materializeRouterOutput(
	output: RouterOutput,
	_urls: string[],
	pathHints: string[],
): ExecutionPlan {
	if (output.strategy === "direct" || output.tasks.length === 0) {
		return {
			strategy: "direct",
			rationale: output.rationale,
			tasks: [],
			reducer: "conversation",
		}
	}

	if (output.strategy === "background") {
		const first = output.tasks[0]
		if (!first) {
			return {
				strategy: "direct",
				rationale: output.rationale,
				tasks: [],
				reducer: "conversation",
			}
		}
		return {
			strategy: "background",
			rationale: output.rationale,
			tasks: [createBackgroundTask(first.goal, first.specialist === "browser")],
			reducer: "conversation",
		}
	}

	const tasks = output.tasks.map((task) => materializeTask(task, pathHints))

	return {
		strategy: output.strategy,
		rationale: output.rationale,
		tasks,
		reducer: output.needsValidation ? "validator" : "conversation",
	}
}

// ---------------------------------------------------------------------------
// Main export — LLM-based execution planner
// ---------------------------------------------------------------------------

export async function buildExecutionPlan(params: {
	request: string
	config: AgentRunConfig
	getModel: (id?: string) => LanguageModel
}): Promise<ExecutionPlan> {
	const urls = extractUrls(params.request)
	const pathHints = extractPathHints(params.request)

	const prompt = buildRouterPrompt({
		request: params.request,
		urls,
		pathHints,
		runtime: params.config.runtime,
	})

	try {
		const { object } = await generateObject({
			model: params.getModel(params.config.modelPolicy.highReasoningModelId),
			schema: routerOutputSchema,
			prompt,
		})
		return materializeRouterOutput(object, urls, pathHints)
	} catch (error) {
		console.warn("[router] LLM router failed, defaulting to research:", error)
		return {
			strategy: "sequential",
			rationale: "Router fallback — defaulting to research specialist.",
			tasks: [
				createSpecialistTask("research", {
					kind: "specialist",
					goal: params.request,
					payload: { request: params.request },
				}),
			],
			reducer: "conversation",
		}
	}
}
